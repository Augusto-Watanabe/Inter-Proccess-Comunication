const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Iniciando build dos programas C++...');

// Verificar se estamos no WSL ou Windows
const isWSL = process.env.WSL_DISTRO_NAME !== undefined;
const isWindows = process.platform === 'win32' && !isWSL;

console.log(`📋 Plataforma: ${process.platform}`);
console.log(`🐧 WSL: ${isWSL}`);
console.log(`🪟 Windows: ${isWindows}`);

if (isWSL) {
    console.log('🐧 Detectado WSL, usando make...');
    exec('cd backend && make', (error, stdout, stderr) => {
        handleBuildResult(error, stdout, stderr);
    });
} else if (isWindows) {
    console.log('🪟 Detectado Windows nativo, compilando com g++...');
    compileForWindows();
} else {
    console.log('🐧 Detectado Linux, usando make...');
    exec('cd backend && make', (error, stdout, stderr) => {
        handleBuildResult(error, stdout, stderr);
    });
}

function compileForWindows() {
    const commands = [
        'g++ -std=c++11 -o backend/pipes/pipe_monitor.exe backend/pipes/pipe_monitor.cpp',
        'g++ -std=c++11 -o backend/sockets/server.exe backend/sockets/server.cpp',
        'g++ -std=c++11 -o backend/sockets/client.exe backend/sockets/client.cpp',
        'g++ -std=c++11 -o backend/shared_memory/shared_memory.exe backend/shared_memory/shared_memory.cpp'
    ];

    function runCommand(command, index) {
        console.log(`📦 Compilando (${index + 1}/${commands.length})...`);
        
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Erro ao compilar: ${error.message}`);
                return;
            }
            if (stderr) {
                console.warn(`⚠️  Avisos: ${stderr}`);
            }
            
            // Próximo comando
            if (index + 1 < commands.length) {
                runCommand(commands[index + 1], index + 1);
            } else {
                console.log('🎉 Build completo!');
                verifyBuild();
            }
        });
    }

    if (commands.length > 0) {
        runCommand(commands[0], 0);
    }
}

function handleBuildResult(error, stdout, stderr) {
    if (error) {
        console.error(`❌ Erro no build: ${error.message}`);
        return;
    }
    if (stderr) {
        console.warn(`⚠️  Avisos: ${stderr}`);
    }
    if (stdout) {
        console.log(`📋 Output: ${stdout}`);
    }
    console.log('✅ Build executado');
    verifyBuild();
}

function verifyBuild() {
    console.log('\n🔍 Verificando executáveis...');
    
    const possibleFiles = [
        'backend/pipes/pipe_monitor',
        'backend/pipes/pipe_monitor.exe',
        'backend/sockets/server',
        'backend/sockets/server.exe', 
        'backend/sockets/client',
        'backend/sockets/client.exe',
        'backend/shared_memory/shared_memory',
        'backend/shared_memory/shared_memory.exe'
    ];
    
    let foundFiles = [];
    
    possibleFiles.forEach(file => {
        try {
            if (fs.existsSync(file)) {
                foundFiles.push(file);
                console.log(`✅ ${file}`);
            }
        } catch (error) {
            // Ignora erros de acesso
        }
    });
    
    if (foundFiles.length > 0) {
        console.log(`\n🎉 Encontrados ${foundFiles.length} executáveis`);
    } else {
        console.log('\n❌ Nenhum executável encontrado. Verifique os erros acima.');
    }
}