const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { spawn, exec } = require('child_process');

const app = express();
const PORT = 3000;

// ==================== CONFIGURAÇÃO ====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('frontend'));

// Middleware de logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// ==================== VARIÁVEIS GLOBAIS ====================
const activeProcesses = new Map();
const clients = new Set();

// Estados dos mecanismos IPC
const ipcStates = {
    pipes: {
        running: false,
        buffer: 0,
        messages: []
    },
    sockets: {
        server: { running: false, connections: 0 },
        client: { running: false, connected: false }
    },
    memory: {
        writer: { running: false },
        reader: { running: false },
        semaphore: 'unlocked',
        data: '',
        counter: 0,
        lastWriter: null
    }
};

// ==================== ROTAS PRINCIPAIS ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Rota de saúde da API
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        processes: activeProcesses.size,
        uptime: process.uptime()
    });
});

// ==================== GERENCIAMENTO DE PROCESSOS ====================
// Executar processo C++
app.post('/api/run', async (req, res) => {
    try {
        const { category, program, args = [] } = req.body;
        
        console.log(`Solicitado: ${category}/${program}`, args);

        // Verificar se o programa existe
        const executablePath = findExecutable(category, program);
        if (!executablePath) {
            return res.status(404).json({
                success: false,
                error: `Executável ${program} não encontrado`,
                solution: 'Execute o build primeiro: cd backend && make'
            });
        }

        // Criar processo
        const child = spawn(executablePath, args, {
            cwd: path.dirname(executablePath),
            stdio: ['pipe', 'pipe', 'pipe'] // Garante que stdin, stdout, stderr sejam pipes
        });

        const processId = Date.now().toString();
        
        const processData = {
            id: processId,
            category,
            program,
            process: child,
            args,
            output: [],
            startTime: new Date()
        };

        // Evitar que o processo filho feche o stdin prematuramente
        child.stdin.on('error', (err) => {
            console.error(`Erro no stdin do processo ${processId}:`, err.message);
        });

        activeProcesses.set(processId, processData);

        // Atualizar estado
        updateIpcState(category, program, true);

        // Configurar handlers de output
        setupProcessHandlers(child, processData);

        res.json({
            success: true,
            processId,
            message: `${program} iniciado com sucesso`
        });

    } catch (error) {
        console.error('Erro ao executar processo:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Listar processos ativos
app.get('/api/processes', (req, res) => {
    const processes = Array.from(activeProcesses.entries()).map(([id, data]) => ({
        id,
        category: data.category,
        program: data.program,
        args: data.args,
        running: data.process.exitCode === null,
        exitCode: data.process.exitCode,
        startTime: data.startTime,
        outputLength: data.output.length
    }));
    
    res.json(processes);
});

// Parar processo
app.post('/api/process/:id/stop', (req, res) => {
    const processId = req.params.id;
    const processData = activeProcesses.get(processId);
    
    if (!processData) {
        return res.status(404).json({ error: 'Processo não encontrado' });
    }

    try {
        // Envia SIGINT primeiro para um encerramento gracioso, depois SIGTERM se necessário
        processData.process.kill('SIGINT'); 
        
        setTimeout(() => {
            if (!processData.process.killed) processData.process.kill('SIGTERM');
        }, 1000); // Força o encerramento após 1 segundo
        
        res.json({ success: true, message: 'Processo parado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Enviar comando para processo (stdin)
app.post('/api/process/:id/command', (req, res) => {
    const processId = req.params.id;
    const { command } = req.body;
    const processData = activeProcesses.get(processId);
    
    if (!processData) {
        return res.status(404).json({ error: 'Processo não encontrado' });
    }

    if (!command) {
        return res.status(400).json({ error: 'Comando não especificado' });
    }

    try {
        processData.process.stdin.write(command + '\n');
        res.json({ success: true, message: 'Comando enviado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== ESTADOS IPC ====================
// Obter estado atual dos mecanismos
app.get('/api/state', (req, res) => {
    res.json(ipcStates);
});

// Atualizar estado do pipe
app.post('/api/state/pipe', (req, res) => {
    const { buffer, message } = req.body;
    
    if (buffer !== undefined) {
        ipcStates.pipes.buffer = buffer;
    }
    
    if (message) {
        ipcStates.pipes.messages.push({
            message,
            timestamp: new Date().toISOString(),
            direction: 'out'
        });
        
        // Simular resposta após delay
        setTimeout(() => {
            ipcStates.pipes.messages.push({
                message: `ECHO: ${message}`,
                timestamp: new Date().toISOString(),
                direction: 'in'
            });
            
            // Enviar atualização via SSE
            emitSSE({
                type: 'pipe_update',
                data: {
                    buffer: ipcStates.pipes.buffer,
                    message: `Recebido: ${message}`
                }
            });
        }, 500);
    }
    
    res.json({ success: true, state: ipcStates.pipes });
});

// Atualizar estado de sockets
app.post('/api/state/socket', (req, res) => {
    const { type, message } = req.body;
    
    if (type === 'client_message' && message) {
        // Simular resposta do servidor
        setTimeout(() => {
            emitSSE({
                type: 'socket_message',
                data: {
                    from: 'server',
                    message: `ECHO: ${message}`,
                    timestamp: new Date().toISOString()
                }
            });
        }, 300);
    }
    
    if (type === 'connection_change') {
        ipcStates.sockets.client.connected = message === 'connected';
        if (message === 'connected') {
            ipcStates.sockets.server.connections++;
        } else {
            ipcStates.sockets.server.connections = Math.max(0, ipcStates.sockets.server.connections - 1);
        }
    }
    
    res.json({ success: true, state: ipcStates.sockets });
});

// Atualizar estado de memória
app.post('/api/state/memory', (req, res) => {
    const { operation, data } = req.body;
    
    switch (operation) {
        case 'write':
            ipcStates.memory.data = data;
            ipcStates.memory.counter++;
            ipcStates.memory.lastWriter = 'user';
            ipcStates.memory.semaphore = 'locked';
            
            // Simular leitura após delay
            setTimeout(() => {
                ipcStates.memory.semaphore = 'unlocked';
                emitSSE({
                    type: 'memory_update',
                    data: {
                        operation: 'read',
                        data: ipcStates.memory.data,
                        counter: ipcStates.memory.counter
                    }
                });
            }, 1000);
            break;
            
        case 'clean':
            ipcStates.memory.data = '';
            ipcStates.memory.counter = 0;
            ipcStates.memory.lastWriter = null;
            ipcStates.memory.semaphore = 'unlocked';
            break;
    }
    
    res.json({ success: true, state: ipcStates.memory });
});

// ==================== SERVER-SENT EVENTS ====================
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const clientId = Date.now();
    const client = { id: clientId, res };
    clients.add(client);

    // Enviar estado inicial
    res.write(`data: ${JSON.stringify({
        type: 'connected',
        message: 'Conectado ao servidor',
        timestamp: new Date().toISOString()
    })}\n\n`);

    // Heartbeat para manter conexão
    const heartbeatInterval = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        } catch (error) {
            clearInterval(heartbeatInterval);
        }
    }, 30000);

    req.on('close', () => {
        clearInterval(heartbeatInterval);
        clients.delete(client);
        console.log(`Cliente ${clientId} desconectado`);
    });
});

// ==================== UTILITÁRIOS ====================
// Encontrar executável
function findExecutable(category, program) {
    const possiblePaths = [
        path.join(__dirname, 'backend', category, program),
        path.join(__dirname, 'backend', category, program + '.exe')
    ];
    
    for (const execPath of possiblePaths) {
        try {
            if (fs.existsSync(execPath)) {
                // Verificar se é executável
                fs.accessSync(execPath, fs.constants.X_OK);
                return execPath;
            }
        } catch (error) {
            console.log(`Arquivo encontrado mas sem permissão: ${execPath}`);
            // Tentar dar permissão
            try {
                fs.chmodSync(execPath, 0o755);
                console.log(`Permissão concedida: ${execPath}`);
                return execPath;
            } catch (chmodError) {
                console.log(`Não foi possível dar permissão: ${chmodError.message}`);
            }
        }
    }
    
    return null;
}

// Configurar handlers de processo
function setupProcessHandlers(child, processData) {
    // stdout
    child.stdout.on('data', (data) => {
        const output = data.toString().trim();
        const lines = output.split('\n').filter(line => line.trim());
        
        lines.forEach(line => {
            addOutputToProcess(processData, line);
            // Processar output específico
            processOutput(line, processData);
        });
    });

    // stderr
    child.stderr.on('data', (data) => {
        const error = data.toString().trim();
        processData.output.push({
            type: 'stderr',
            timestamp: new Date().toISOString(),
            message: error
        });
        
        emitSSE({
            type: 'error',
            processId: processData.id,
            category: processData.category,
            program: processData.program,
            data: error
        });
    });

    // on close
    child.on('close', (code) => {
        processData.exitCode = code;
        processData.endTime = new Date().toISOString();
        
        emitSSE({
            type: 'exit',
            processId: processData.id,
            category: processData.category,
            program: processData.program,
            data: `Processo finalizado com código ${code}`
        });
        
        // Atualizar estado
        updateIpcState(processData.category, processData.program, false);
        
        // Remover após um tempo
        setTimeout(() => {
            activeProcesses.delete(processData.id);
        }, 5000);
    });

    // on error
    child.on('error', (error) => {
        processData.output.push({
            type: 'stderr',
            timestamp: new Date().toISOString(),
            message: `Erro: ${error.message}`
        });
        
        emitSSE({
            type: 'error',
            processId: processData.id,
            category: processData.category,
            program: processData.program,
            data: error.message
        });
        
        updateIpcState(processData.category, processData.program, false);
    });
}

// Processar output específico
function processOutput(line, processData) {
    try {
        // Tentar parsear JSON
        const data = JSON.parse(line);
        emitSSE({
            type: 'json_output',
            processId: processData.id,
            category: processData.category,
            program: processData.program,
            data: data
        });
        
        // Atualizar estados baseado no JSON
        if (data.type === 'pipe') {
            updatePipeState(data);
        } else if (data.type === 'socket') {
            updateSocketState(data);
        } else if (data.type === 'memory') {
            updateMemoryState(data);
        }
        
    } catch (e) {
        // Não é JSON, processar como texto
        if (line.includes('connected') || line.includes('conectado')) {
            updateSocketState({ message: line });
        } else if (line.includes('writing') || line.includes('escrita')) {
            updateMemoryState({ operation: 'write', data: line });
        } else {
            // Se não for JSON e não for um caso especial, emitir como output genérico
            emitGenericOutput(processData, line);
        }
    }
}

function addOutputToProcess(processData, line, type = 'stdout') {
    processData.output.push({
        type: type,
        timestamp: new Date().toISOString(),
        message: line
    });
}

function emitGenericOutput(processData, line) {
    emitSSE({
        type: 'output',
        processId: processData.id,
        category: processData.category,
        program: processData.program,
        data: line
    });
}

// Atualizar estados IPC
function updateIpcState(category, program, running) {
    switch (category) {
        case 'pipes':
            ipcStates.pipes.running = running;
            if (!running) {
                ipcStates.pipes.buffer = 0;
                ipcStates.pipes.messages = [];
            }
            break;
            
        case 'sockets':
            if (program === 'server') {
                ipcStates.sockets.server.running = running;
                if (!running) {
                    ipcStates.sockets.server.connections = 0;
                    ipcStates.sockets.client.connected = false;
                }
            } else if (program === 'client') {
                ipcStates.sockets.client.running = running;
                if (!running) {
                    ipcStates.sockets.client.connected = false;
                }
            }
            break;
            
        case 'shared_memory':
            if (program === 'writer') {
                ipcStates.memory.writer.running = running;
            } else if (program === 'reader') {
                ipcStates.memory.reader.running = running;
            }
            if (!running) {
                ipcStates.memory.semaphore = 'unlocked';
            }
            break;
    }
    
    // Emitir atualização de estado
    emitSSE({
        type: 'state_update',
        data: { category, program, running }
    });
}

function updatePipeState(data) {
    if (data.message && data.message.includes('escrita')) {
        ipcStates.pipes.buffer += data.data?.length || 10;
    } else if (data.message && data.message.includes('leitura')) {
        ipcStates.pipes.buffer = Math.max(0, ipcStates.pipes.buffer - 10);
    }
}

function updateSocketState(data) {
    if (data.message && data.message.includes('conectado')) {
        ipcStates.sockets.client.connected = true;
        ipcStates.sockets.server.connections++;
    } else if (data.message && data.message.includes('desconectado')) {
        ipcStates.sockets.client.connected = false;
        ipcStates.sockets.server.connections = Math.max(0, ipcStates.sockets.server.connections - 1);
    }
}

function updateMemoryState(data) {
    if (data.operation === 'write') {
        ipcStates.memory.data = data.data;
        ipcStates.memory.counter++;
        ipcStates.memory.lastWriter = data.pid || 'system';
        ipcStates.memory.semaphore = 'locked';
    } else if (data.operation === 'read') {
        ipcStates.memory.semaphore = 'unlocked';
    }
}

// Emitir SSE
function emitSSE(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    clients.forEach(client => {
        try {
            client.res.write(message);
        } catch (error) {
            console.log('Erro ao enviar SSE para cliente:', error);
            clients.delete(client);
        }
    });
}

// ==================== ROTAS DE DEBUG ====================
app.get('/api/debug', (req, res) => {
    res.json({
        currentDir: __dirname,
        backendExists: fs.existsSync(path.join(__dirname, 'backend')),
        frontendExists: fs.existsSync(path.join(__dirname, 'frontend')),
        activeProcesses: activeProcesses.size,
        connectedClients: clients.size,
        ipcStates: ipcStates,
        timestamp: new Date().toISOString()
    });
});

// Listar programas disponíveis
app.get('/api/programs', (req, res) => {
    const categories = ['pipes', 'sockets', 'shared_memory'];
    const programs = {};
    
    categories.forEach(category => {
        const categoryPath = path.join(__dirname, 'backend', category);
        programs[category] = [];
        
        try {
            if (fs.existsSync(categoryPath)) {
                const files = fs.readdirSync(categoryPath);
                files.forEach(file => {
                    const fullPath = path.join(categoryPath, file);
                    try {
                        const stats = fs.statSync(fullPath);
                        if (stats.isFile() && 
                            !file.endsWith('.cpp') && 
                            !file.endsWith('.h') &&
                            file !== 'Makefile') {
                            programs[category].push(file);
                        }
                    } catch (error) {
                        console.log(`Erro ao acessar ${file}:`, error.message);
                    }
                });
            }
        } catch (error) {
            console.log(`Erro ao ler pasta ${category}:`, error.message);
        }
    });
    
    res.json(programs);
});

// ==================== INICIALIZAÇÃO ====================
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em: http://localhost:${PORT}`);
    console.log(`📁 Diretório: ${__dirname}`);
    
    // Verificar estrutura
    console.log('\n📋 Verificando estrutura...');
    checkProjectStructure();
});

function checkProjectStructure() {
    const requiredFolders = ['backend', 'frontend'];
    const requiredBackend = ['pipes', 'sockets', 'shared_memory'];
    
    requiredFolders.forEach(folder => {
        const path = `./${folder}`;
        if (fs.existsSync(path)) {
            console.log(`✅ ${folder}/`);
            if (folder === 'backend') {
                requiredBackend.forEach(subFolder => {
                    const subPath = `./backend/${subFolder}`;
                    if (fs.existsSync(subPath)) {
                        console.log(`   ✅ ${subFolder}/`);
                        // Verificar executáveis
                        const files = fs.readdirSync(subPath);
                        const executables = files.filter(f => 
                            !f.endsWith('.cpp') && 
                            !f.endsWith('.h') && 
                            f !== 'Makefile'
                        );
                        if (executables.length > 0) {
                            console.log(`      Executáveis: ${executables.join(', ')}`);
                        } else {
                            console.log(`      ⚠️  Nenhum executável encontrado`);
                        }
                    } else {
                        console.log(`   ❌ ${subFolder}/ (não encontrado)`);
                    }
                });
            }
        } else {
            console.log(`❌ ${folder}/ (não encontrado)`);
        }
    });
    
    console.log('\n💡 Dica: Execute "cd backend && make" para compilar os programas');
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Desligando servidor...');
    
    // Parar todos os processos
    activeProcesses.forEach((processData, id) => {
        try {
            processData.process.kill('SIGTERM');
        } catch (error) {
            console.log(`Erro ao parar processo ${id}:`, error.message);
        }
    });
    
    process.exit(0);
});