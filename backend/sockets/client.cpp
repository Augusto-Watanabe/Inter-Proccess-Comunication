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
              const std::string& component = "", const std::string& data = "") {
    
    std::cout << "{";
    std::cout << "\"timestamp\": \"" << getTimestamp() << "\",";
    std::cout << "\"type\": \"" << type << "\",";
    std::cout << "\"component\": \"" << component << "\",";
    std::cout << "\"message\": \"" << message << "\"";
    
    if (!data.empty()) {
        std::cout << ",\"data\": \"" << data << "\"";
    }
    
    std::cout << "}" << std::endl;
}

int main(int argc, char* argv[]) {
    int sockfd;
    struct sockaddr_un server_addr;
    char buffer[BUFFER_SIZE];
    
    logEvent("system", "Cliente iniciando", "client");
    
    if (argc < 2) {
        logEvent("error", "Uso: client <mensagem>", "client");
        return 1;
    }
    
    std::string message = argv[1];
    logEvent("send", "Preparando para enviar mensagem", "client", message);
    
    // Criar socket
    sockfd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (sockfd == -1) {
        logEvent("error", "Erro ao criar socket", "client");
        return 1;
    }
    logEvent("socket", "Socket criado com sucesso", "client");
    
    // Configurar endereço do servidor
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sun_family = AF_UNIX;
    strncpy(server_addr.sun_path, SOCKET_PATH, sizeof(server_addr.sun_path) - 1);
    
    // Conectar ao servidor
    if (connect(sockfd, (struct sockaddr*)&server_addr, sizeof(server_addr)) == -1) {
        logEvent("error", "Erro ao conectar com servidor", "client");
        close(sockfd);
        return 1;
    }
    logEvent("connection", "Conectado ao servidor", "client", SOCKET_PATH);
    
    // Enviar mensagem
    write(sockfd, message.c_str(), message.length());
    logEvent("send", "Mensagem enviada para servidor", "client", message);
    
    // Ler resposta
    ssize_t bytes_read = read(sockfd, buffer, BUFFER_SIZE - 1);
    if (bytes_read > 0) {
        buffer[bytes_read] = '\0';
        logEvent("receive", "Resposta recebida do servidor", "client", buffer);
    }
    
    // Fechar conexão
    close(sockfd);
    logEvent("connection", "Conexão fechada", "client");
    
    return 0;
}