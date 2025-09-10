const { exec } = require('child_process');

console.log('🐧 Executando make...');

exec('cd backend && make', (error, stdout, stderr) => {
    if (error) {
        console.error(`❌ Erro no make: ${error.message}`);
        return;
    }
    if (stderr) {
        console.warn(`⚠️  Avisos: ${stderr}`);
    }
    console.log(`✅ Make output: ${stdout || 'Comando executado com sucesso'}`);
    verifyBuild();
});

function verifyBuild() {
    const { execSync } = require('child_process');
    const fs = require('fs');
    
    console.log('\n🔍 Verificando executáveis...');
    
    try {
        // Listar executáveis no backend
        const output = execSync('find backend -type f -executable -not -name "*.cpp" -not -name "Makefile"').toString();
        const executables = output.split('\n').filter(line => line.trim());
        
        if (executables.length > 0) {
            console.log('✅ Executáveis encontrados:');
            executables.forEach(exe => console.log(`   📍 ${exe}`));
        } else {
            console.log('❌ Nenhum executável encontrado');
        }
    } catch (error) {
        console.log('❌ Erro ao verificar executáveis:', error.message);
    }
}