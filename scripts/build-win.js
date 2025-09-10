const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🪟 Compilando para Windows...');

const commands = [
    // Compilar pipes
    'g++ -std=c++11 -o backend/pipes/pipe_monitor backend/pipes/pipe_monitor.cpp',
    
    // Compilar sockets
    'g++ -std=c++11 -o backend/sockets/server backend/sockets/server.cpp',
    'g++ -std=c++11 -o backend/sockets/client backend/sockets/client.cpp',
    
    // Compilar memória compartilhada
    'g++ -std=c++11 -o backend/shared_memory/shared_memory backend/shared_memory/shared_memory.cpp'
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
        console.log(`✅ ${stdout || 'Compilado com sucesso'}`);
        
        // Próximo comando
        if (index + 1 < commands.length) {
            runCommand(commands[index + 1], index + 1);
        } else {
            console.log('🎉 Build completo!');
            verifyBuild();
        }
    });
}

function verifyBuild() {
    console.log('\n🔍 Verificando executáveis...');
    
    const executables = [
        'backend/pipes/pipe_monitor.exe',
        'backend/sockets/server.exe',
        'backend/sockets/client.exe',
        'backend/shared_memory/shared_memory.exe'
    ];
    
    let allOk = true;
    
    executables.forEach(exe => {
        if (fs.existsSync(exe)) {
            console.log(`✅ ${exe} - OK`);
        } else {
            console.log(`❌ ${exe} - Não encontrado`);
            allOk = false;
        }
    });
    
    if (allOk) {
        console.log('\n🎉 Todos os executáveis foram criados com sucesso!');
    } else {
        console.log('\n⚠️  Alguns executáveis não foram criados. Verifique os erros acima.');
    }
}

// Iniciar o primeiro comando
if (commands.length > 0) {
    runCommand(commands[0], 0);
} else {
    console.log('ℹ️  Nenhum comando de compilação definido.');
}