class IPCManager {
    constructor() {
        this.eventSource = null;
        this.activeProcesses = new Map();
        this.messageCount = 0;
        this.processCount = 0;
        this.startTime = new Date();
        this.isConnected = false;
        
        // Estados dos mecanismos
        this.states = {
            pipes: {
                running: false,
                buffer: 0,
                status: 'inactive'
            },
            sockets: {
                server: { running: false, connections: 0 },
                client: { running: false, connected: false }
            },
            memory: {
                manager: { running: false },
                semaphore: 'Liberado',
                lastWriter: null,
                counter: 0
            }
        };

        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setupTabNavigation();
        this.updateUptime();
        await this.connectSSE();
        this.startTimers();
    }

    setupEventListeners() {
        // Controles de Pipe
        document.getElementById('startPipe').addEventListener('click', () => this.startPipe());
        document.getElementById('stopPipe').addEventListener('click', () => this.stopPipe());
        document.getElementById('sendPipe').addEventListener('click', () => this.sendPipeMessage());

        // Controles de Socket
        document.getElementById('startServer').addEventListener('click', () => this.startServer());
        document.getElementById('stopServer').addEventListener('click', () => this.stopServer());
        document.getElementById('startClient').addEventListener('click', () => this.startClient());
        document.getElementById('stopClient').addEventListener('click', () => this.stopClient());
        document.getElementById('sendSocket').addEventListener('click', () => this.sendSocketMessage());

        // Controles de Memória
        document.getElementById('startWriter').addEventListener('click', () => this.startWriter());
        document.getElementById('startReader').addEventListener('click', () => this.startReader());
        document.getElementById('stopMemory').addEventListener('click', () => this.stopMemory());
        document.getElementById('cleanMemory').addEventListener('click', () => this.cleanMemory());
        document.getElementById('writeMemory').addEventListener('click', () => this.writeMemory());

        // Controles de Log
        document.getElementById('clearPipeLog').addEventListener('click', () => this.clearLog('pipe'));
        document.getElementById('clearSocketLog').addEventListener('click', () => this.clearLog('socket'));
        document.getElementById('clearMemoryLog').addEventListener('click', () => this.clearLog('memory'));

        // Filtros
        this.setupLogFilters();

        // Enter para enviar mensagens
        this.setupEnterHandlers();
    }

    setupTabNavigation() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabPanes = document.querySelectorAll('.tab-pane');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.dataset.tab;
                
                // Atualizar botões
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                // Atualizar painéis
                tabPanes.forEach(pane => pane.classList.remove('active'));
                document.getElementById(`${tabId}-tab`).classList.add('active');
            });
        });
    }

    setupLogFilters() {
        // Pipe filters
        document.getElementById('showPipeSystem').addEventListener('change', (e) => this.filterLog('pipe', 'system', e.target.checked));
        document.getElementById('showPipeOut').addEventListener('change', (e) => this.filterLog('pipe', 'stdout', e.target.checked));
        document.getElementById('showPipeErr').addEventListener('change', (e) => this.filterLog('pipe', 'stderr', e.target.checked));

        // Socket filters
        document.getElementById('showSocketSystem').addEventListener('change', (e) => this.filterLog('socket', 'system', e.target.checked));
        document.getElementById('showSocketClient').addEventListener('change', (e) => this.filterLog('socket', 'client', e.target.checked));
        document.getElementById('showSocketServer').addEventListener('change', (e) => this.filterLog('socket', 'server', e.target.checked));

        // Memory filters
        document.getElementById('showMemorySystem').addEventListener('change', (e) => this.filterLog('memory', 'system', e.target.checked));
        document.getElementById('showMemoryWrite').addEventListener('change', (e) => this.filterLog('memory', 'writer', e.target.checked));
        document.getElementById('showMemoryRead').addEventListener('change', (e) => this.filterLog('memory', 'reader', e.target.checked));
    }

    setupEnterHandlers() {
        const inputs = ['pipeMessage', 'socketMessage', 'memoryMessage'];
        inputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.sendMessageHandler(inputId);
                }
            });
        });
    }

    sendMessageHandler(inputId) {
        switch (inputId) {
            case 'pipeMessage': this.sendPipeMessage(); break;
            case 'socketMessage': this.sendSocketMessage(); break;
            case 'memoryMessage': this.writeMemory(); break;
        }
    }

    async connectSSE() {
        try {
            this.eventSource = new EventSource('/api/events');
            
            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleEvent(data);
                } catch (e) {
                    console.error('Error parsing SSE data:', e);
                }
            };

            this.eventSource.onopen = () => {
                this.updateConnectionStatus(true);
            };

            this.eventSource.onerror = (error) => {
                console.error('SSE Error:', error);
                this.updateConnectionStatus(false);
                this.reconnectSSE();
            };

            this.isConnected = true;

        } catch (error) {
            console.error('Failed to connect SSE:', error);
            setTimeout(() => this.connectSSE(), 3000);
        }
    }

    reconnectSSE() {
        if (this.eventSource) {
            this.eventSource.close();
        }
        setTimeout(() => this.connectSSE(), 3000);
    }

    handleEvent(data) {
        switch (data.type) {
            case 'output':
                this.processOutput(data);
                break;
            case 'json_output':
                this.handleJSONOutput(data.data, data.category);
                break;
            case 'error':
                this.processError(data);
                break;
            case 'exit':
                this.processExit(data);
                break;
            case 'connected':
                this.updateConnectionStatus(true);
                break;
            case 'state_update':
                this.updateProcessState(data.data.category, data.data.program, data.data.running);
                break;
        }
    }

    processOutput(data) {
        this.messageCount++;
        this.updateGlobalStats();

        try {
            const jsonData = JSON.parse(data.data);
            this.handleJSONOutput(jsonData, data.category);
        } catch (e) {
            this.addLogEntry('stdout', data.data, data.category);
        }
    }

    handleJSONOutput(data, category) {
        switch (data.type) {
            case 'system':
            case 'pipe':
            case 'pipe_write':
            case 'pipe_read':
            case 'process':
            case 'instruction':
            case 'warning':
                this.updatePipeState(data, category);
                break; // A categoria aqui é 'pipes'
            case 'socket':
            case 'connection':
            case 'send':
            case 'receive':
            case 'config':
                this.updateSocketState(data, category);
                break;
            case 'shm':
            case 'semaphore':
            case 'operation':
            case 'write':
            case 'read':
            case 'memory_state':
                this.updateMemoryState(data, category);
                break;
            default:
                const logCategoryDefault = category === 'shared_memory' ? 'memory' : category.replace(/s$/, '');
                this.addLogEntry('stdout', JSON.stringify(data), logCategoryDefault);
        }
    }

    updatePipeState(data, category) {
        // Apenas processa se for da categoria 'pipes'
        if (category !== 'pipes') return;

        if (data.type === 'pipe_write' || data.message.includes('escrita')) {
            this.states.pipes.buffer += data.data?.length || 10;
        } else if (data.type === 'pipe_read' || data.message.includes('leitura')) {
            this.states.pipes.buffer = Math.max(0, this.states.pipes.buffer - 10);
        }
        this.animatePipeFlow();
        this.updatePipeUI();
        
        this.addLogEntry(data.type, data.message, 'pipe', data.pid, data.data);
    }

    updateSocketState(data, category) {
        if (category !== 'sockets') return;

        // Lógica de estado
        if (data.type === 'connection') {
            if (data.component === 'client' && data.message.includes('Conectado ao servidor')) {
                this.states.sockets.client.connected = true;
            } else if (data.component === 'server' && data.message.includes('Cliente conectado')) {
                this.states.sockets.server.connections++;
            } else if (data.message.includes('fechada') || data.message.includes('fechou a conexão')) {
                if (this.states.sockets.client.connected) {
                    this.states.sockets.client.connected = false;
                    this.states.sockets.server.connections = Math.max(0, this.states.sockets.server.connections - 1);
                }
            }
        } else if (data.type === 'system' && data.message.includes('resetado')) {
            this.states.sockets.client.connected = false;
        }

        this.updateSocketUI();
        const logType = data.component || data.type;
        this.addLogEntry(logType, data.message, 'socket', data.pid || data.client_id, data.data);
    }

    updateMemoryState(data, category) {
        if (category !== 'shared_memory') return;

        // Handle full state dump from displayMemoryState()
        if (data.type === 'memory_state') {
            if (data.memory) {
                this.states.memory.counter = data.memory.counter || 0;
                this.states.memory.lastWriter = data.memory.last_writer || 'N/A';
            }
            if (data.semaphore) {
                this.states.memory.semaphore = data.semaphore.available ? 'Liberado' : 'Bloqueado';
            }
        }

        // Log all relevant events that have a message
        if (data.message) {
            const logType = data.process || data.type;
            this.addLogEntry(logType, data.message, 'memory', data.pid, data.data);
        }
        
        this.updateMemoryUI();
    }

    processError(data) {
        this.addLogEntry('stderr', data.data, data.category);
    }

    processExit(data) {
        const processData = this.activeProcesses.get(data.processId);
        if (processData) {
            this.activeProcesses.delete(data.processId);
            this.processCount--;
            this.updateGlobalStats();
            const logMessage = `Processo ${processData.program} finalizado (código: ${data.data.replace('Processo finalizado com código ', '')})`;
            const logCategory = processData.category === 'shared_memory' ? 'memory' : processData.category.replace(/s$/, '');
            this.addLogEntry('system', logMessage, logCategory);
            
            this.updateProcessState(processData.category, processData.program, false);
        }
    }

    updateProcessState(category, program, running) {
        switch (category) {
            case 'pipes':
                this.states.pipes.running = running;
                this.states.pipes.status = running ? 'active' : 'inactive';
                this.updatePipeUI();
                break;
            case 'sockets':
                if (program === 'server') {
                    this.states.sockets.server.running = running;
                    if (!running) {
                        this.states.sockets.server.connections = 0;
                        this.states.sockets.client.connected = false;
                    }
                } else if (program === 'client') {
                    this.states.sockets.client.running = running;
                    if (!running) {
                        this.states.sockets.client.connected = false;
                    }
                }
                this.updateSocketUI();
                break;
            case 'shared_memory':
                // O novo modelo usa um único gerenciador
                this.states.memory.manager.running = running;
                if (!running) {
                    // Resetar UI ao parar
                    this.states.memory.semaphore = 'Liberado';
                    this.states.memory.lastWriter = 'Nenhum';
                    this.states.memory.counter = 0;
                }
                this.updateMemoryUI();
                break;
        }
    }

    // === CONTROLES DOS PROCESSOS ===
    async startPipe() {
        // Inicia o processo e aguarda a confirmação
        const processInfo = await this.runProcess('pipes', 'pipe_monitor', []);
        if (!processInfo || !processInfo.processId) {
            this.addLogEntry('stderr', 'Não foi possível iniciar o processo de pipe.', 'pipe');
            return;
        }

        // Envia comandos de inicialização
        const processId = processInfo.processId;
        this.addLogEntry('system', 'Configurando o pipe...', 'pipe');
        await this.sendCommand(processId, 'create_pipe');
        await this.sendCommand(processId, 'create_fork');
        this.addLogEntry('system', 'Pipe pronto para uso.', 'pipe');
    }

    async stopPipe() {
        const pipeProcess = this.findProcessByCategory('pipes');
        if (pipeProcess) {
            this.addLogEntry('system', 'Enviando comando para fechar o pipe...', 'pipe');
            await this.sendCommand(pipeProcess.id, 'close_pipe');
            // O processo C++ se encerrará e o backend emitirá um evento 'exit'
        }
    }

    async sendPipeMessage() {
        const message = document.getElementById('pipeMessage').value.trim();
        if (!message) {
            this.addLogEntry('stderr', 'A mensagem não pode estar vazia.', 'pipe');
            return;
        }

        const pipeProcess = this.findProcessByCategory('pipes');
        if (!pipeProcess) {
            this.addLogEntry('stderr', 'Nenhum processo de pipe ativo para enviar a mensagem.', 'pipe');
            return;
        }

        await this.sendCommand(pipeProcess.id, `send ${message}`);
        document.getElementById('pipeMessage').value = '';
    }

    async startServer() {
        await this.runProcess('sockets', 'server', []);
    }

    async stopServer() {
        const serverProcess = this.findProcessByCategory('sockets', 'server');
        if (serverProcess) await this.stopProcess(serverProcess.id);
    }

    async startClient() {
        const processInfo = await this.runProcess('sockets', 'client', []);
        if (!processInfo || !processInfo.processId) {
            this.addLogEntry('stderr', 'Não foi possível iniciar o processo de cliente.', 'socket');
            return;
        }

        // Envia comandos de inicialização
        const processId = processInfo.processId;
        this.addLogEntry('system', 'Configurando o cliente socket...', 'socket');
        await this.sendCommand(processId, 'create_socket');
        await this.sendCommand(processId, 'connect');
    }

    async stopClient() {
        const clientProcess = this.findProcessByCategory('sockets', 'client');
        if (clientProcess) {
            this.addLogEntry('system', 'Enviando comando para encerrar o cliente...', 'socket');
            await this.sendCommand(clientProcess.id, 'exit');
        }
    }

    async sendSocketMessage() {
        const message = document.getElementById('socketMessage').value.trim();
        if (!message) {
            this.addLogEntry('stderr', 'A mensagem não pode estar vazia.', 'socket');
            return;
        }

        if (!this.states.sockets.client.connected) {
            this.addLogEntry('stderr', 'Cliente não conectado ao servidor', 'socket');
            return;
        }

        const clientProcess = this.findProcessByCategory('sockets', 'client');
        if (!clientProcess) {
            this.addLogEntry('stderr', 'Processo do cliente não encontrado.', 'socket');
            return;
        }

        await this.sendCommand(clientProcess.id, `send ${message}`);
        await this.sendCommand(clientProcess.id, 'receive'); // Tenta receber a resposta
        document.getElementById('socketMessage').value = '';
    }

    async startWriter() {
        const processInfo = await this.runProcess('shared_memory', 'shared_memory', []);
        if (!processInfo || !processInfo.processId) {
            this.addLogEntry('stderr', 'Não foi possível iniciar o gerenciador de memória.', 'memory');
            return;
        }

        const processId = processInfo.processId;
        this.addLogEntry('system', 'Configurando memória compartilhada...', 'memory');
        await this.sendCommand(processId, 'create');
        await this.sendCommand(processId, 'attach');
        this.addLogEntry('system', 'Memória compartilhada pronta para uso.', 'memory');
    }

    async startReader() {
        const memoryProcess = this.findProcessByCategory('shared_memory');
        if (!memoryProcess) {
            this.addLogEntry('stderr', 'Gerenciador de memória não está em execução. Inicie o processo primeiro.', 'memory');
            return;
        }
        this.addLogEntry('system', 'Enviando comando para ler da memória...', 'memory');
        await this.sendCommand(memoryProcess.id, 'read');
    }

    async stopMemory() {
        const memoryProcess = this.findProcessByCategory('shared_memory');
        if (memoryProcess) {
            this.addLogEntry('system', 'Enviando comando para encerrar o gerenciador...', 'memory');
            await this.sendCommand(memoryProcess.id, 'exit');
        }
    }

    async cleanMemory() {
        const memoryProcess = this.findProcessByCategory('shared_memory');
        if (memoryProcess) {
            this.addLogEntry('system', 'Enviando comando para limpar a memória...', 'memory');
            await this.sendCommand(memoryProcess.id, 'cleanup');
            this.addLogEntry('system', 'Comando de limpeza enviado ao gerenciador.', 'memory');
        } else {
            this.addLogEntry('system', 'Iniciando processo temporário para limpeza...', 'memory');
            const processInfo = await this.runProcess('shared_memory', 'shared_memory', []);
            if (processInfo && processInfo.processId) {
                await this.sendCommand(processInfo.processId, 'cleanup');
                await this.sendCommand(processInfo.processId, 'exit'); // Auto-exit
                this.addLogEntry('system', 'Comando de limpeza enviado a processo temporário.', 'memory');
            }
        }
    }

    async writeMemory() {
        const message = document.getElementById('memoryMessage').value.trim();
        if (!message) {
            this.addLogEntry('stderr', 'A mensagem não pode estar vazia.', 'memory');
            return;
        }

        const memoryProcess = this.findProcessByCategory('shared_memory');
        if (!memoryProcess) {
            this.addLogEntry('stderr', 'Gerenciador de memória não está em execução.', 'memory');
            return;
        }

        await this.sendCommand(memoryProcess.id, `write ${message}`);
        document.getElementById('memoryMessage').value = '';
    }

    // === API COMMUNICATION ===
    async runProcess(category, program, args = []) {
        this.showLoading(`Iniciando ${program}...`);
        let result;
        const logCategory = category === 'shared_memory' ? 'memory' : category.replace(/s$/, '');

        try {
            const response = await fetch('/api/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ category, program, args })
            });

            result = await response.json();
            
            if (result.success) {
                this.activeProcesses.set(result.processId, {
                    category,
                    program,
                    args,
                    startTime: new Date()
                });
                
                this.processCount++;
                this.updateGlobalStats();
                
                this.addLogEntry('system', `✅ ${program} iniciado (ID: ${result.processId})`, logCategory);
                
            } else {
                this.addLogEntry('stderr', `❌ Erro: ${result.error || result.message}`, logCategory);
                return null; // Retorna nulo em caso de falha
            }

        } catch (error) {
            this.addLogEntry('stderr', `❌ Erro de conexão: ${error.message}`, logCategory);
            return null;
        } finally {
            this.hideLoading();
        }

        return result; // Retorna o resultado da API
    }

    async stopProcess(processId) {
        try {
            const response = await fetch(`/api/process/${processId}/stop`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (result.success) {
                // O log de parada é tratado pelo evento 'exit'
            } else {
                this.addLogEntry('stderr', `❌ Erro ao parar processo: ${result.error}`, 'system');
            }
        } catch (error) {
            this.addLogEntry('stderr', `❌ Erro ao parar processo: ${error.message}`, 'system');
        }
    }

    async sendCommand(processId, command) {
        try {
            const response = await fetch(`/api/process/${processId}/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command })
            });
            const result = await response.json();
            if (!result.success) {
                this.addLogEntry('stderr', `❌ Erro ao enviar comando: ${result.error}`, 'system');
            }
        } catch (error) {
            this.addLogEntry('stderr', `❌ Erro de conexão ao enviar comando: ${error.message}`, 'system');
        }
    }

    // === UI UPDATES ===
    updatePipeUI() {
        // Atualizar status
        document.getElementById('pipeStatus').textContent = 
            this.states.pipes.running ? 'Ativo' : 'Inativo';
        
        document.getElementById('pipeStatus').className = 
            `value ${this.states.pipes.running ? 'connected' : 'disconnected'}`;
        
        // Atualizar buffer
        document.getElementById('pipeBuffer').textContent = this.states.pipes.buffer;
        
        // Atualizar botões
        document.getElementById('startPipe').disabled = this.states.pipes.running;
        document.getElementById('stopPipe').disabled = !this.states.pipes.running;
        document.getElementById('sendPipe').disabled = !this.states.pipes.running;
    }

    updateSocketUI() {
        // Servidor
        document.getElementById('serverState').textContent = 
            this.states.sockets.server.running ? 'Online' : 'Offline';
        
        document.getElementById('serverConnections').textContent = 
            this.states.sockets.server.connections;
        
        document.getElementById('serverNodeStatus').textContent = 
            this.states.sockets.server.running ? 'Online' : 'Offline';
        
        // Cliente
        document.getElementById('clientNodeStatus').textContent = 
            this.states.sockets.client.connected ? 'Conectado' : 
            this.states.sockets.client.running ? 'Conectando...' : 'Offline';
        
        // Conexão
        const connectionLine = document.getElementById('connectionLine');
        connectionLine.querySelector('.line').className = 
            `line ${this.states.sockets.client.connected ? 'connected' : ''}`;
        
        connectionLine.querySelector('.connection-status').textContent = 
            this.states.sockets.client.connected ? 'Conectado' : 'Desconectado';
        
        // Botões
        document.getElementById('stopServer').disabled = !this.states.sockets.server.running;
        document.getElementById('stopClient').disabled = !this.states.sockets.client.running;
        document.getElementById('sendSocket').disabled = !this.states.sockets.client.connected;
    }

    updateMemoryUI() {
        // Atualizar informações
        document.getElementById('semaphoreStatus').textContent = this.states.memory.semaphore;
        
        document.getElementById('lastWriter').textContent = 
            this.states.memory.lastWriter || 'Nenhum';
        
        document.getElementById('memoryCounter').textContent = this.states.memory.counter;
        
        // Atualizar visualização da memória
        this.updateMemoryGrid();
        
        // Botões
        const managerRunning = this.states.memory.manager.running;
        document.getElementById('startWriter').disabled = managerRunning;
        document.getElementById('startReader').disabled = !managerRunning;
        document.getElementById('stopMemory').disabled = !managerRunning;
        document.getElementById('cleanMemory').disabled = false; // Limpeza pode ser feita a qualquer momento
        document.getElementById('writeMemory').disabled = !managerRunning;
    }

    updateMemoryGrid() {
        const memoryContent = document.getElementById('memoryContent');
        memoryContent.innerHTML = `
            <div class="memory-row ${this.states.memory.counter > 0 ? 'updated' : ''}">
                <span>0x1000</span>
                <span>${this.states.memory.lastWriter ? 'Dados escritos' : 'Vazio'}</span>
                <span>${this.states.memory.semaphore === 'locked' ? '🔒' : '🔓'}</span>
            </div>
            <div class="memory-row">
                <span>0x1008</span>
                <span>Contador: ${this.states.memory.counter}</span>
                <span>📊</span>
            </div>
        `;
    }

    animatePipeFlow() {
        const dataFlow = document.getElementById('pipeDataFlow');
        dataFlow.classList.add('flowing');
        
        setTimeout(() => {
            dataFlow.classList.remove('flowing');
        }, 2000);
    }

    addLogEntry(type, message, category, pid = null, data = null) {
        const logContainer = document.getElementById(`${category}Log`);
        const timestamp = new Date().toLocaleTimeString();
        
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.innerHTML = `
            <span class="log-timestamp">[${timestamp}]</span>
            <span class="log-message">${this.escapeHtml(message)}</span>
            ${data ? `<span class="log-data">"${this.escapeHtml(data)}"</span>` : ''}
            ${pid ? `<span class="log-pid">PID:${pid}</span>` : ''}
        `;
        
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
        
        // Atualizar contador global
        this.messageCount++;
        this.updateGlobalStats();
    }

    clearLog(category) {
        const logContainer = document.getElementById(`${category}Log`);
        logContainer.innerHTML = '';
        this.addLogEntry('system', 'Log limpo', category);
    }

    filterLog(category, type, show) {
        const logContainer = document.getElementById(`${category}Log`);
        const entries = logContainer.querySelectorAll('.log-entry');
        
        entries.forEach(entry => {
            if (entry.classList.contains(type)) {
                entry.style.display = show ? 'block' : 'none';
            }
        });
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connectionStatus');
        statusElement.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
        statusElement.innerHTML = connected ? 
            '<i class="fas fa-plug"></i><span>Conectado</span>' :
            '<i class="fas fa-plug"></i><span>Desconectado</span>';
    }

    updateGlobalStats() {
        document.getElementById('globalProcessCount').textContent = this.processCount;
        document.getElementById('globalMessageCount').textContent = this.messageCount;
        
        // Atualizar status do servidor baseado em processos ativos
        const hasActiveProcesses = this.processCount > 0;
        const serverStatus = document.getElementById('serverStatus');
        serverStatus.className = `status-indicator ${hasActiveProcesses ? 'connected' : 'disconnected'}`;
        serverStatus.innerHTML = hasActiveProcesses ?
            '<i class="fas fa-server"></i><span>Servidor ativo</span>' :
            '<i class="fas fa-server"></i><span>Servidor ocioso</span>';
    }

    updateUptime() {
        const now = new Date();
        const diff = now - this.startTime;
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        
        document.getElementById('uptime').textContent = 
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    startTimers() {
        // Atualizar uptime a cada segundo
        setInterval(() => this.updateUptime(), 1000);
        
        // Verificar conexão periodicamente
        setInterval(() => {
            if (!this.isConnected) {
                this.updateConnectionStatus(false);
            }
        }, 5000);
    }

    showLoading(message = 'Processando...') {
        const modal = document.getElementById('loadingModal');
        const messageElement = document.getElementById('loadingMessage');
        
        messageElement.textContent = message;
        modal.style.display = 'flex';
    }

    hideLoading() {
        const modal = document.getElementById('loadingModal');
        modal.style.display = 'none';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    findProcessByCategory(category, program = null) {
        for (const [id, process] of this.activeProcesses) {
            if (process.category === category && (!program || process.program === program)) {
                return { id, ...process };
            }
        }
        return null;
    }
}

// Inicialização quando a página carregar
let ipcManager;

document.addEventListener('DOMContentLoaded', () => {
    ipcManager = new IPCManager();
    window.ipcManager = ipcManager; // Para debugging
    
    console.log('IPC Manager inicializado');
    
    // Verificar automaticamente o status da API
    setTimeout(() => {
        fetch('/api/health')
            .then(response => response.json())
            .then(data => {
                console.log('API Status:', data);
            })
            .catch(error => {
                console.error('API de health check não disponível:', error);
            });
    }, 1000);
});

// Funções globais para acesso via console
window.debugIPC = function() {
    console.log('Processos ativos:', ipcManager.activeProcesses);
    console.log('Estados:', ipcManager.states);
    console.log('Estatísticas:', {
        processes: ipcManager.processCount,
        messages: ipcManager.messageCount,
        uptime: new Date() - ipcManager.startTime
    });
};

// Hotkeys para desenvolvimento
document.addEventListener('keydown', (e) => {
    // Ctrl+D para debug
    if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        window.debugIPC();
    }
    
    // Ctrl+L para limpar todos os logs
    if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        ['pipe', 'socket', 'memory'].forEach(category => {
            const logContainer = document.getElementById(`${category}Log`);
            if (logContainer) logContainer.innerHTML = '';
        });
    }
});