class ProcessMonitor {
    constructor() {
        this.eventSource = null;
        this.currentProcessId = null;
        this.isConnected = false;
        this.init();
    }

    async init() {
        await this.connectSSE();
        await this.loadProcesses();
        setInterval(() => this.loadProcesses(), 3000);
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

            this.eventSource.onerror = (error) => {
                console.error('SSE Error:', error);
                this.reconnectSSE();
            };

            this.isConnected = true;
            this.addOutput('✅ Conectado ao servidor de eventos', 'system');
            
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
                this.addOutput(data.data, 'stdout', data.category, data.program);
                break;
            case 'error':
                this.addOutput(data.data, 'stderr', data.category, data.program);
                break;
            case 'exit':
                this.addOutput(data.data, 'exit', data.category, data.program);
                this.loadProcesses();
                break;
        }
    }

    async runProcess(category, program, args = []) {
        try {
            const response = await fetch('/api/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ category, program, args })
            });

            const result = await response.json();
            
            if (result.success) {
                this.currentProcessId = result.processId;
                this.addOutput(
                    `🚀 Processo ${category}/${program} iniciado (ID: ${result.processId})`, 
                    'system',
                    category,
                    program
                );
                this.loadProcesses();
            } else {
                this.addOutput(`❌ Erro: ${result.message}`, 'stderr', category, program);
            }
        } catch (error) {
            this.addOutput(`❌ Erro de conexão: ${error.message}`, 'stderr', category, 'system');
        }
    }

    async loadProcesses() {
        try {
            const response = await fetch('/api/processes');
            const processes = await response.json();
            this.displayProcesses(processes);
        } catch (error) {
            console.error('Error loading processes:', error);
            this.addOutput('❌ Erro ao carregar processos', 'stderr', 'system', 'api');
        }
    }

    displayProcesses(processes) {
        const container = document.getElementById('processesContainer');
        
        if (!processes || processes.length === 0) {
            container.innerHTML = '<div class="loading">Nenhum processo ativo</div>';
            return;
        }

        container.innerHTML = processes.map(process => `
            <div class="process-card ${process.running ? 'running' : 'stopped'}">
                <h4>${process.category}/${process.program}</h4>
                <div class="process-info">
                    <p><strong>ID:</strong> ${process.id}</p>
                    <p><strong>Args:</strong> ${process.args.join(' ') || 'Nenhum'}</p>
                    <p><strong>Status:</strong> ${process.running ? '🟢 Executando' : '🔴 Parado'}</p>
                    ${process.exitCode !== undefined ? 
                        `<p><strong>Código de saída:</strong> ${process.exitCode}</p>` : ''}
                </div>
                ${process.running ? `
                    <button onclick="stopProcess('${process.id}')" class="btn btn-clean">
                        Parar
                    </button>
                ` : ''}
            </div>
        `).join('');
    }

    addOutput(message, type = 'stdout', category = 'system', program = 'system') {
        const outputDiv = document.getElementById('output');
        if (!outputDiv) {
            console.error('Elemento output não encontrado!');
            return;
        }
        
        const line = document.createElement('div');
        line.className = `output-line ${type}`;
        
        // Verifica se é JSON
        if (message.trim().startsWith('{') && message.trim().endsWith('}')) {
            try {
                const jsonData = JSON.parse(message);
                message = JSON.stringify(jsonData, null, 2);
                line.classList.add('json');
            } catch (e) {
                // Não é JSON válido
            }
        }
        
        const timestamp = new Date().toLocaleTimeString();
        const prefix = category !== 'system' ? `[${category}/${program}]` : '';
        
        line.innerHTML = `
            <span class="timestamp">[${timestamp}]</span>
            <span class="prefix">${prefix}</span>
            <span class="message">${this.escapeHtml(message)}</span>
        `;
        
        outputDiv.appendChild(line);
        outputDiv.scrollTop = outputDiv.scrollHeight;
        
        this.filterOutput();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    filterOutput() {
        const showJson = document.getElementById('showJson');
        const showStdout = document.getElementById('showStdout');
        const showStderr = document.getElementById('showStderr');
        
        if (!showJson || !showStdout || !showStderr) return;
        
        const lines = document.querySelectorAll('.output-line');
        lines.forEach(line => {
            const isJson = line.classList.contains('json');
            const isStdout = line.classList.contains('stdout');
            const isStderr = line.classList.contains('stderr');
            const isSystem = line.classList.contains('system');
            const isExit = line.classList.contains('exit');

            let shouldShow = false;
            
            if (isJson && showJson.checked) shouldShow = true;
            if (isStdout && showStdout.checked) shouldShow = true;
            if (isStderr && showStderr.checked) shouldShow = true;
            if (isSystem || isExit) shouldShow = true;

            line.style.display = shouldShow ? 'block' : 'none';
        });
    }

    clearOutput() {
        const outputDiv = document.getElementById('output');
        if (outputDiv) {
            outputDiv.innerHTML = '';
            this.addOutput('✅ Output limpo', 'system');
        }
    }

    async checkBuild() {
        try {
            const response = await fetch('/api/programs');
            const programs = await response.json();
            this.displayBuildStatus(programs);
        } catch (error) {
            this.addOutput(`❌ Erro ao verificar build: ${error.message}`, 'stderr', 'system', 'build');
        }
    }

    displayBuildStatus(programs) {
        const statusDiv = document.getElementById('buildStatus');
        if (!statusDiv) return;
        
        let html = '<div class="build-info">';
        
        if (!programs) {
            html += '<p>❌ Não foi possível verificar o build</p>';
        } else {
            for (const [category, progs] of Object.entries(programs)) {
                html += `<h4>${category.toUpperCase()}</h4>`;
                if (progs.length > 0) {
                    html += `<ul>`;
                    progs.forEach(prog => {
                        html += `<li>✅ ${prog}</li>`;
                    });
                    html += `</ul>`;
                } else {
                    html += `<p>❌ Nenhum programa compilado</p>`;
                }
            }
        }
        
        html += '</div>';
        statusDiv.innerHTML = html;
    }

    async buildAll() {
        try {
            this.addOutput('🔨 Build manual necessário:', 'system', 'build', 'make');
            this.addOutput('💡 Execute no terminal: cd backend && make', 'stdout', 'build', 'make');
            this.addOutput('💡 Ou em cada subpasta: make', 'stdout', 'build', 'make');
            
            // Verificar o status após instruções
            setTimeout(() => this.checkBuild(), 1000);
        } catch (error) {
            this.addOutput(`❌ Erro: ${error.message}`, 'stderr', 'build', 'make');
        }
    }
}

// ==================== FUNÇÕES GLOBAIS ==================== 
// (Essas são as funções que os botões chamam)

async function runProcess(category, program, args) {
    if (window.monitor) {
        await monitor.runProcess(category, program, args);
    } else {
        console.error('Monitor não inicializado');
    }
}

async function runCustomCommand() {
    const category = document.getElementById('customCategory').value;
    const program = document.getElementById('customProgram').value;
    const argsInput = document.getElementById('customArgs').value;
    
    const args = argsInput.split(' ').filter(arg => arg.trim() !== '');
    
    if (window.monitor) {
        await monitor.runProcess(category, program, args);
        document.getElementById('customArgs').value = '';
    }
}

async function stopProcess(processId) {
    try {
        const response = await fetch(`/api/process/${processId}/stop`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success && window.monitor) {
            monitor.addOutput(`⏹️ Processo ${processId} parado`, 'system');
            monitor.loadProcesses();
        }
    } catch (error) {
        if (window.monitor) {
            monitor.addOutput(`❌ Erro ao parar processo: ${error.message}`, 'stderr');
        }
    }
}

function clearOutput() {
    if (window.monitor) {
        monitor.clearOutput();
    }
}

function filterOutput() {
    if (window.monitor) {
        monitor.filterOutput();
    }
}

async function buildAll() {
    if (window.monitor) {
        await monitor.buildAll();
    }
}

async function checkBuild() {
    if (window.monitor) {
        await monitor.checkBuild();
    }
}

// ==================== INICIALIZAÇÃO ====================

let monitor;

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM carregado, inicializando monitor...');
    
    monitor = new ProcessMonitor();
    window.monitor = monitor; // Torna global para debugging

    // Configurar event listener para categoria
    const categorySelect = document.getElementById('customCategory');
    const programSelect = document.getElementById('customProgram');
    
    if (categorySelect && programSelect) {
        categorySelect.addEventListener('change', function() {
            const programs = {
                'pipes': ['pipe_monitor'],
                'sockets': ['server', 'client'],
                'shared_memory': ['shared_memory']
            };
            
            programSelect.innerHTML = '';
            programs[this.value].forEach(program => {
                const option = document.createElement('option');
                option.value = program;
                option.textContent = program;
                programSelect.appendChild(option);
            });
        });
        
        // Disparar change event para preencher inicialmente
        categorySelect.dispatchEvent(new Event('change'));
    }

    // Verificar build automaticamente após 2 segundos
    setTimeout(() => {
        if (monitor && typeof monitor.checkBuild === 'function') {
            monitor.checkBuild();
        }
    }, 2000);
});

// Função global para debugging
window.debugMonitor = function() {
    console.log('Monitor:', window.monitor);
    console.log('EventSource:', window.monitor?.eventSource);
};