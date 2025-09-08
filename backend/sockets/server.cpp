#include <iostream>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cstring>
#include <ctime>
#include <sstream>
#include <iomanip>

#define SOCKET_PATH "/tmp/demo_socket"
#define BUFFER_SIZE 1024

// Função para obter timestamp
std::string getTimestamp() {
    std::time_t now = std::time(nullptr);
    std::tm* tm = std::localtime(&now);
    
    std::stringstream ss;
    ss << std::put_time(tm, "%Y-%m-%d %H:%M:%S");
    return ss.str();
}

// Função para log em JSON
void logEvent(const std::string& type, const std::string& message, 
              const std::string& component = "", int client_id = -1, 
              const std::string& data = "") {
    
    std::cout << "{";
    std::cout << "\"timestamp\": \"" << getTimestamp() << "\",";
    std::cout << "\"type\": \"" << type << "\",";
    std::cout << "\"component\": \"" << component << "\",";
    if (client_id != -1) {
        std::cout << "\"client_id\": " << client_id << ",";
    }
    std::cout << "\"message\": \"" << message << "\"";
    
    if (!data.empty()) {
        std::cout << ",\"data\": \"" << data << "\"";
    }
    
    std::cout << "}" << std::endl;
}

int main() {
    int server_fd, client_fd;
    struct sockaddr_un server_addr, client_addr;
    socklen_t client_len = sizeof(client_addr);
    char buffer[BUFFER_SIZE];
    
    logEvent("system", "Servidor iniciando", "server");
    
    // Criar socket
    server_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (server_fd == -1) {
        logEvent("error", "Erro ao criar socket", "server");
        return 1;
    }
    logEvent("socket", "Socket criado com sucesso", "server");
    
    // Configurar endereço do servidor
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sun_family = AF_UNIX;
    strncpy(server_addr.sun_path, SOCKET_PATH, sizeof(server_addr.sun_path) - 1);
    
    // Remover socket anterior se existir
    unlink(SOCKET_PATH);
    
    // Bind do socket
    if (bind(server_fd, (struct sockaddr*)&server_addr, sizeof(server_addr)) == -1) {
        logEvent("error", "Erro no bind", "server");
        close(server_fd);
        return 1;
    }
    logEvent("socket", "Bind realizado com sucesso", "server", -1, SOCKET_PATH);
    
    // Listen
    if (listen(server_fd, 5) == -1) {
        logEvent("error", "Erro no listen", "server");
        close(server_fd);
        return 1;
    }
    logEvent("socket", "Servidor ouvindo conexões", "server");
    
    int client_counter = 0;
    
    while (true) {
        logEvent("socket", "Aguardando conexão de cliente...", "server");
        
        // Aceitar conexão
        client_fd = accept(server_fd, (struct sockaddr*)&client_addr, &client_len);
        if (client_fd == -1) {
            logEvent("error", "Erro ao aceitar conexão", "server");
            continue;
        }
        
        client_counter++;
        logEvent("connection", "Cliente conectado", "server", client_counter);
        
        // Ler dados do cliente
        ssize_t bytes_read = read(client_fd, buffer, BUFFER_SIZE - 1);
        if (bytes_read > 0) {
            buffer[bytes_read] = '\0';
            logEvent("receive", "Mensagem recebida do cliente", "server", client_counter, buffer);
            
            // Processar mensagem (echo)
            std::string response = "ECHO: ";
            response += buffer;
            
            // Enviar resposta
            write(client_fd, response.c_str(), response.length());
            logEvent("send", "Resposta enviada para cliente", "server", client_counter, response);
        }
        
        // Fechar conexão com cliente
        close(client_fd);
        logEvent("connection", "Conexão com cliente fechada", "server", client_counter);
    }
    
    // Fechar socket do servidor (não alcançável neste loop infinito)
    close(server_fd);
    unlink(SOCKET_PATH);
    
    return 0;
}