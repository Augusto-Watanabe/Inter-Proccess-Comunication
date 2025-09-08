#include <iostream>
#include <unistd.h>
#include <sys/wait.h>
#include <string.h>

int main() {
    int pipefd[2]; // pipefd[0] para leitura, pipefd[1] para escrita
    pid_t pid;
    char buffer[100];
    
    // Criar o pipe
    if (pipe(pipefd) == -1) {
        std::cerr << "Erro ao criar pipe" << std::endl;
        return 1;
    }
    
    // Criar processo filho
    pid = fork();
    
    if (pid < 0) {
        std::cerr << "Erro ao criar processo filho" << std::endl;
        return 1;
    }
    
    if (pid > 0) { // Processo pai
        close(pipefd[0]); // Fecha a extremidade de leitura no pai
        
        std::string mensagem = "Olá do processo pai!";
        std::cout << "Pai escrevendo: " << mensagem << std::endl;
        
        // Escrever no pipe
        write(pipefd[1], mensagem.c_str(), mensagem.length() + 1);
        close(pipefd[1]); // Fecha a extremidade de escrita
        
        // Esperar pelo processo filho terminar
        wait(NULL);
        
    } else { // Processo filho
        close(pipefd[1]); // Fecha a extremidade de escrita no filho
        
        // Ler do pipe
        ssize_t bytes_lidos = read(pipefd[0], buffer, sizeof(buffer));
        if (bytes_lidos > 0) {
            std::cout << "Filho recebeu: " << buffer << std::endl;
        }
        
        close(pipefd[0]); // Fecha a extremidade de leitura
    }
    
    return 0;
}