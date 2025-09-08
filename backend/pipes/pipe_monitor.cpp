#include <iostream>
#include <unistd.h>
#include <sys/wait.h>
#include <string.h>
#include <ctime>
#include <sstream>
#include <iomanip>

// Função para obter timestamp formatado
std::string getTimestamp() {
    std::time_t now = std::time(nullptr);
    std::tm* tm = std::localtime(&now);
    
    std::stringstream ss;
    ss << std::put_time(tm, "%Y-%m-%d %H:%M:%S");
    return ss.str();
}

// Função para gerar JSON de evento
void logEvent(const std::string& type, const std::string& message, 
              const std::string& process = "", pid_t pid = 0, 
              const std::string& data = "") {
    
    std::cout << "{";
    std::cout << "\"timestamp\": \"" << getTimestamp() << "\",";
    std::cout << "\"type\": \"" << type << "\",";
    std::cout << "\"process\": \"" << process << "\",";
    std::cout << "\"pid\": " << pid << ",";
    std::cout << "\"message\": \"" << message << "\"";
    
    if (!data.empty()) {
        std::cout << ",\"data\": \"" << data << "\"";
    }
    
    std::cout << "}" << std::endl;
}

int main() {
    int pipefd[2];
    pid_t pid;
    char buffer[100];
    
    // Log de início do programa
    logEvent("system", "Programa iniciado", "main", getpid());
    
    // Criar o pipe
    if (pipe(pipefd) == -1) {
        logEvent("error", "Erro ao criar pipe", "main", getpid());
        return 1;
    }
    logEvent("pipe", "Pipe criado com sucesso", "main", getpid());
    
    // Criar processo filho
    pid = fork();
    
    if (pid < 0) {
        logEvent("error", "Erro ao criar processo filho", "main", getpid());
        return 1;
    }
    
    if (pid > 0) { // Processo pai
        logEvent("process", "Processo pai iniciado", "parent", getpid());
        close(pipefd[0]); // Fecha a extremidade de leitura
        
        std::string mensagem = "Olá do processo pai!";
        logEvent("send", "Preparando para enviar mensagem", "parent", getpid(), mensagem);
        
        // Escrever no pipe
        write(pipefd[1], mensagem.c_str(), mensagem.length() + 1);
        logEvent("pipe_write", "Mensagem escrita no pipe", "parent", getpid(), mensagem);
        
        close(pipefd[1]); // Fecha a extremidade de escrita
        logEvent("pipe", "Extremidade de escrita fechada", "parent", getpid());
        
        // Esperar pelo processo filho terminar
        logEvent("process", "Aguardando término do filho", "parent", getpid());
        wait(NULL);
        logEvent("process", "Processo filho finalizado", "parent", getpid());
        
    } else { // Processo filho
        logEvent("process", "Processo filho iniciado", "child", getpid());
        close(pipefd[1]); // Fecha a extremidade de escrita
        
        logEvent("pipe", "Aguardando dados do pipe", "child", getpid());
        
        // Ler do pipe
        ssize_t bytes_lidos = read(pipefd[0], buffer, sizeof(buffer));
        if (bytes_lidos > 0) {
            logEvent("pipe_read", "Mensagem recebida do pipe", "child", getpid(), buffer);
            logEvent("receive", "Dados processados", "child", getpid(), buffer);
        } else {
            logEvent("error", "Nenhum dado recebido", "child", getpid());
        }
        
        close(pipefd[0]); // Fecha a extremidade de leitura
        logEvent("pipe", "Extremidade de leitura fechada", "child", getpid());
    }
    
    logEvent("system", "Processo finalizado", 
             (pid > 0) ? "parent" : "child", getpid());
    
    return 0;
}