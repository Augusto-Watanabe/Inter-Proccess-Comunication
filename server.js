const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { spawn } = require('child_process'); // ✅ IMPORTANTE: Adicionar spawn

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// Middleware para log de requisições
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Debug route
app.get('/api/debug', (req, res) => {
    try {
        res.json({
            success: true,
            currentDir: __dirname,
            backendExists: fs.existsSync(path.join(__dirname, 'backend')),
            frontendExists: fs.existsSync(path.join(__dirname, 'frontend')),
            filesInRoot: fs.readdirSync(__dirname),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obter lista de programas disponíveis
function getAvailablePrograms() {
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
                        
                        // Verificar se é arquivo executável
                        if (stats.isFile() && 
                            !file.endsWith('.cpp') && 
                            !file.endsWith('.h') &&
                            !file.endsWith('.md') &&
                            file !== 'Makefile' &&
                            file !== '.gitignore') {
                            
                            programs[category].push(file);
                        }
                    } catch (error) {
                        console.error(`Erro ao acessar ${fullPath}:`, error.message);
                    }
                });
            } else {
                console.warn(`Pasta não encontrada: ${categoryPath}`);
            }
        } catch (error) {
            console.error(`Erro ao ler pasta ${category}:`, error.message);
        }
    });
    
    return programs;
}

// Encontrar executável com verificação de permissão
function findExecutable(category, program) {
    const execPath = path.join(__dirname, 'backend', category, program);
    
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
            console.log(`✅ Permissão concedida: ${execPath}`);
            return execPath;
        } catch (chmodError) {
            console.log(`❌ Não foi possível dar permissão: ${chmodError.message}`);
        }
    }
    
    return null;
}

// Processos ativos
const activeProcesses = new Map();

// Rota para executar processos
app.post('/api/run', (req, res) => {
    const { category, program, args = [] } = req.body;
    
    console.log(`Solicitado: ${category}/${program} com args:`, args);
    
    // Verificar se os programas foram compilados
    const executablePath = findExecutable(category, program);
    
    if (!executablePath) {
        return res.status(404).json({ 
            success: false, 
            error: `Executável ${category}/${program} não encontrado.`,
            solution: 'Execute: cd backend && make',
            details: `Procurou em: ${path.join(__dirname, 'backend', category)}`
        });
    }
    
    console.log(`🎯 Executando: ${executablePath} ${args.join(' ')}`);
    
    try {
        const child = spawn(executablePath, args, {
            cwd: path.dirname(executablePath),
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const processId = Date.now().toString();
        
        const processData = {
            id: processId,
            category: category,
            program: program,
            process: child,
            output: [],
            args: args
        };

        activeProcesses.set(processId, processData);

        // Capturar stdout
        child.stdout.on('data', (data) => {
            const output = data.toString().trim();
            const lines = output.split('\n').filter(line => line.trim() !== '');
            
            lines.forEach(line => {
                processData.output.push({
                    type: 'stdout',
                    timestamp: new Date().toISOString(),
                    message: line
                });
                
                // Emitir via SSE
                emitSSE({
                    type: 'output',
                    processId: processId,
                    category: category,
                    program: program,
                    data: line
                });
            });
        });

        // Capturar stderr
        child.stderr.on('data', (data) => {
            const error = data.toString().trim();
            processData.output.push({
                type: 'stderr',
                timestamp: new Date().toISOString(),
                message: error
            });
            
            emitSSE({
                type: 'error',
                processId: processId,
                category: category,
                program: program,
                data: error
            });
        });

        // Quando processo termina
        child.on('close', (code) => {
            processData.exitCode = code;
            processData.endTime = new Date().toISOString();
            
            emitSSE({
                type: 'exit',
                processId: processId,
                category: category,
                program: program,
                data: `Process exited with code ${code}`
            });
        });

        child.on('error', (error) => {
            processData.output.push({
                type: 'stderr',
                timestamp: new Date().toISOString(),
                message: `Erro ao executar: ${error.message}`
            });
            
            emitSSE({
                type: 'error',
                processId: processId,
                category: category,
                program: program,
                data: `Erro: ${error.message}`
            });
        });

        res.json({ 
            success: true, 
            processId: processId,
            message: `Process ${category}/${program} started`
        });

    } catch (error) {
        console.error('Erro ao executar processo:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro interno ao executar processo',
            message: error.message 
        });
    }
});

// Rota para listar programas disponíveis
app.get('/api/programs', (req, res) => {
    try {
        const programs = getAvailablePrograms();
        console.log('Programas encontrados:', programs);
        res.json(programs);
    } catch (error) {
        console.error('Erro em /api/programs:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Rota para listar processos ativos
app.get('/api/processes', (req, res) => {
    const processes = Array.from(activeProcesses.entries()).map(([id, data]) => ({
        id: id,
        category: data.category,
        program: data.program,
        args: data.args,
        running: !data.exitCode,
        exitCode: data.exitCode,
        startTime: data.startTime,
        endTime: data.endTime
    }));
    
    res.json(processes);
});

// Rota para parar processo
app.post('/api/process/:id/stop', (req, res) => {
    const processData = activeProcesses.get(req.params.id);
    if (!processData) {
        return res.status(404).json({ error: 'Process not found' });
    }
    
    try {
        processData.process.kill('SIGTERM');
        res.json({ success: true, message: 'Process stopped' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota simples de teste
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'API funcionando!',
        timestamp: new Date().toISOString(),
        status: 'OK'
    });
});

// Server-Sent Events
const clients = new Set();

function emitSSE(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    clients.forEach(client => client.res.write(message));
}

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    const client = { id: clientId, res };
    clients.add(client);

    // Enviar evento de conexão
    res.write('data: {"type": "connected", "message": "Conectado ao servidor"}\n\n');

    req.on('close', () => {
        clients.delete(client);
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Erro não tratado:', error);
    res.status(500).json({ 
        error: 'Erro interno do servidor',
        message: error.message
    });
});

// Rota para arquivos não encontrados
app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada', path: req.url });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em: http://localhost:${PORT}`);
    console.log(`📁 Diretório atual: ${__dirname}`);
    
    // Verificar estrutura de pastas
    console.log('\n📋 Estrutura de pastas:');
    try {
        const files = fs.readdirSync(__dirname);
        console.log('Arquivos no diretório principal:', files);
        
        if (fs.existsSync('backend')) {
            console.log('Pasta backend encontrada');
            const backendFiles = fs.readdirSync('backend');
            console.log('Conteúdo de backend:', backendFiles);
            
            // Verificar cada subpasta
            const categories = ['pipes', 'sockets', 'shared_memory'];
            categories.forEach(category => {
                const categoryPath = path.join('backend', category);
                if (fs.existsSync(categoryPath)) {
                    const files = fs.readdirSync(categoryPath);
                    console.log(`  ${category}:`, files);
                } else {
                    console.log(`  ❌ ${category}: Não encontrada`);
                }
            });
        } else {
            console.log('❌ Pasta backend NÃO encontrada');
        }
        
        if (fs.existsSync('frontend')) {
            console.log('Pasta frontend encontrada');
            const frontendFiles = fs.readdirSync('frontend');
            console.log('Conteúdo de frontend:', frontendFiles);
        } else {
            console.log('❌ Pasta frontend NÃO encontrada');
        }
    } catch (error) {
        console.error('Erro ao verificar estrutura:', error.message);
    }
});