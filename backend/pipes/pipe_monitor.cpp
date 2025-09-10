#include <iostream>
#include <unistd.h>
#include <sys/wait.h>
#include <cstring>
#include <ctime>
#include <sstream>
#include <iomanip>
#include <cerrno>
#include <string>
#include <fcntl.h>

// Função para obter timestamp formatado
std::string getTimestamp() {
    std::time_t now = std::time(nullptr);
    std::tm* tm = std::localtime(&now);
    
    std::stringstream ss;
    ss << std::put_time(tm, "%Y-%m-%d %H:%M:%S");
    return ss.str();
}

// Função para escapar caracteres especiais em uma string JSON
std::string escapeJson(const std::string& s) {
    std::stringstream o;
    for (char c : s) {
        switch (c) {
            case '"':  o << "\\\""; break;
            case '\\': o << "\\\\"; break;
            case '\b': o << "\\b";  break;
            case '\f': o << "\\f";  break;
            case '\n': o << "\\n";  break;
            case '\r': o << "\\r";  break;
            case '\t': o << "\\t";  break;
            default:
                if ('\x00' <= c && c <= '\x1f') {
                    o << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(c);
                } else {
                    o << c;
                }
        }
    }
    return o.str();
}

// Função para gerar JSON de evento
void logEvent(const std::string& type, const std::string& message, 
              const std::string& process = "", pid_t pid = 0, 
              const std::string& data = "") {
    std::stringstream json;
    json << "{\"timestamp\":\"" << getTimestamp() << "\",\"type\":\"" << type << "\",\"process\":\"" << process << "\",\"pid\":" << pid << ",\"message\":\"" << escapeJson(message) << "\"";
    if (!data.empty()) {
        json << ",\"data\":\"" << escapeJson(data) << "\"";
    }
    json << "}" << std::endl;
    std::cout << json.str();
    std::cout.flush(); // Garante que o output seja enviado imediatamente
}

// Estrutura para gerenciar o estado do pipe
struct PipeState {
    int pipefd[2];
    pid_t child_pid;
    bool pipe_created;
    bool fork_done;
    bool pipe_open;
    
    PipeState() : pipefd{-1, -1}, child_pid(-1), pipe_created(false), 
                 fork_done(false), pipe_open(false) {}
};

PipeState pipe_state;

// Função para criar o pipe
void createPipe() {
    if (pipe_state.pipe_created) {
        logEvent("warning", "Pipe já criado anteriormente", "main", getpid());
        return;
    }
    
    if (pipe(pipe_state.pipefd) == -1) {
        std::string error_msg = "Erro ao criar pipe: " + std::string(strerror(errno));
        logEvent("error", error_msg, "main", getpid());
        return;
    }
    
    pipe_state.pipe_created = true;
    logEvent("pipe", "Pipe criado com sucesso", "main", getpid(), 
             "read_fd=" + std::to_string(pipe_state.pipefd[0]) + 
             " write_fd=" + std::to_string(pipe_state.pipefd[1]));
}

// Loop de leitura dedicado para o processo filho
void childReadLoop() {
    logEvent("pipe_read", "Filho pronto para ler mensagens do pipe...", "child", getpid());
    char buffer[256];

    // Loop de leitura bloqueante
    while (true) {
        ssize_t bytes_lidos = read(pipe_state.pipefd[0], buffer, sizeof(buffer) - 1);
        
        if (bytes_lidos > 0) {
            buffer[bytes_lidos] = '\0';
            std::string received_data(buffer);
            logEvent("pipe_read", "Mensagem recebida", "child", getpid(), received_data);
        } else if (bytes_lidos == 0) {
            // Fim do arquivo (EOF): o pai fechou a extremidade de escrita.
            logEvent("pipe", "Pipe fechado pelo escritor. Filho encerrando.", "child", getpid());
            break; // Sai do loop
        } else {
            logEvent("error", "Erro na leitura do pipe: " + std::string(strerror(errno)), "child", getpid());
            break; // Sai em caso de erro
        }
    }
    close(pipe_state.pipefd[0]);
}

// Função para fazer fork e criar processos
void createFork() {
    if (!pipe_state.pipe_created) {
        logEvent("error", "Pipe não criado. Execute createPipe primeiro.", "main", getpid());
        return;
    }
    
    if (pipe_state.fork_done) {
        logEvent("warning", "Fork já realizado anteriormente", "main", getpid());
        return;
    }
    
    pipe_state.child_pid = fork();
    
    if (pipe_state.child_pid < 0) {
        logEvent("error", "Erro ao criar processo filho: " + std::string(strerror(errno)), "main", getpid());
        return;
    }
    
    pipe_state.fork_done = true;
    
    if (pipe_state.child_pid > 0) { // Processo pai
        logEvent("process", "Processo pai iniciado", "parent", getpid());
        close(pipe_state.pipefd[0]); // Fecha a extremidade de leitura no pai
        pipe_state.pipe_open = true;
        
    } else { // Processo filho
        logEvent("process", "Processo filho iniciado", "child", getpid());
        close(pipe_state.pipefd[1]); // Fecha a extremidade de escrita no filho
        pipe_state.pipe_open = true;

        // Filho entra em seu próprio loop e não retorna para o main
        childReadLoop();
        exit(0); // Garante que o filho termine após o loop
    }
}

// Função para enviar mensagem através do pipe (apenas no pai)
void sendMessage(const std::string& message) {
    if (!pipe_state.pipe_open) {
        logEvent("error", "Pipe não está aberto", "parent", getpid());
        return;
    }
    
    if (pipe_state.child_pid == 0) {
        logEvent("error", "Esta função só pode ser chamada pelo processo pai", "child", getpid());
        return;
    }
    
    logEvent("pipe_write", "Escrevendo no pipe", "parent", getpid(), message);
    
    ssize_t bytes_escritos = write(pipe_state.pipefd[1], message.c_str(), message.length());
    if (bytes_escritos < 0) {
        logEvent("error", "Erro ao escrever no pipe: " + std::string(strerror(errno)), "parent", getpid());
    } else {
        logEvent("pipe_write", "Mensagem escrita com sucesso", "parent", getpid(), 
                 "bytes=" + std::to_string(bytes_escritos));
    }
}

// Função para ler mensagens do pipe (apenas no filho)
void readMessages() {
    if (!pipe_state.pipe_open) {
        logEvent("error", "Pipe não está aberto", "child", getpid());
        return;
    }
    
    if (pipe_state.child_pid > 0) {
        logEvent("error", "Esta função só pode ser chamada pelo processo filho", "parent", getpid());
        return;
    }
    
    logEvent("pipe_read", "Iniciando leitura do pipe", "child", getpid());
    
    // Configurar o pipe para não-bloqueante
    int flags = fcntl(pipe_state.pipefd[0], F_GETFL, 0);
    fcntl(pipe_state.pipefd[0], F_SETFL, flags | O_NONBLOCK);
    
    char buffer[256];
    bool data_available = true;
    
    while (data_available && pipe_state.pipe_open) {
        ssize_t bytes_lidos = read(pipe_state.pipefd[0], buffer, sizeof(buffer) - 1);
        
        if (bytes_lidos > 0) {
            buffer[bytes_lidos] = '\0';
            std::string received_data(buffer);
            logEvent("pipe_read", "Mensagem recebida", "child", getpid(), received_data);
        } 
        else if (bytes_lidos == 0) {
            logEvent("pipe", "Pipe fechado pelo escritor", "child", getpid());
            data_available = false;
        }
        else if (errno == EAGAIN || errno == EWOULDBLOCK) {
            // Não há dados disponíveis no momento
            data_available = false;
        }
        else {
            logEvent("error", "Erro na leitura do pipe: " + std::string(strerror(errno)), "child", getpid());
            data_available = false;
        }
        
        // Pequena pausa para evitar loop muito rápido
        usleep(100000); // 100ms
    }
}

// Função para fechar o pipe e finalizar processos
void closePipe() {
    if (!pipe_state.pipe_open) {
        logEvent("warning", "Pipe já está fechado", "main", getpid());
        return;
    }
    
    if (pipe_state.child_pid > 0) { // Processo pai
        logEvent("pipe", "Fechando extremidade de escrita", "parent", getpid());
        close(pipe_state.pipefd[1]);
        
        logEvent("process", "Aguardando término do filho", "parent", getpid());
        waitpid(pipe_state.child_pid, NULL, 0);
        logEvent("process", "Processo filho finalizado", "parent", getpid());
        
    } else if (pipe_state.child_pid == 0) { // Processo filho
        logEvent("pipe", "Fechando extremidade de leitura", "child", getpid());
        close(pipe_state.pipefd[0]);
    }
    
    pipe_state.pipe_open = false;
    logEvent("system", "Pipe fechado com sucesso", "main", getpid());
}

// Função para resetar completamente o estado
void resetPipe() {
    if (pipe_state.pipe_open) {
        closePipe();
    }
    
    // Resetar o estado
    pipe_state.pipefd[0] = -1;
    pipe_state.pipefd[1] = -1;
    pipe_state.child_pid = -1;
    pipe_state.pipe_created = false;
    pipe_state.fork_done = false;
    
    logEvent("system", "Estado do pipe resetado", "main", getpid());
}

// Função principal com controle por comandos
int main() {
    logEvent("system", "Pipe Monitor iniciado - Aguardando comandos", "main", getpid());
    logEvent("instruction", "Comandos disponíveis: create_pipe, create_fork, send <message>, read, close_pipe, reset, exit", "main", getpid());
    
    std::string command;
    
    while (true) {
        // Ler comando do stdin
        if (!std::getline(std::cin, command)) {
            break;
        }
        
        // Processar comando
        if (command == "create_pipe") {
            createPipe();
        }
        else if (command == "create_fork") {
            createFork();
        }
        else if (command.find("send ") == 0) {
            if (command.length() > 5) {
                std::string message = command.substr(5);
                sendMessage(message);
            } else {
                logEvent("error", "Comando send requer uma mensagem", "main", getpid());
            }
        }
        else if (command == "close_pipe") {
            closePipe();
            break; // Adicionado para encerrar o loop principal após fechar o pipe
        }
        else if (command == "reset") {
            resetPipe();
        }
        else if (command == "exit") {
            logEvent("system", "Encerrando Pipe Monitor", "main", getpid());
            break;
        }
        else if (!command.empty()) {
            logEvent("error", "Comando não reconhecido: " + command, "main", getpid());
        }
        
        // Pequena pausa para evitar consumo excessivo de CPU
        usleep(10000); // 10ms
    }
    
    // Limpeza final se necessário
    if (pipe_state.pipe_open) {
        closePipe();
    }
    
    return 0;
}