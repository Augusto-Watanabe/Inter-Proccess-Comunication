#include <iostream>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cstring>
#include <ctime>
#include <sstream>
#include <iomanip>
#include <string>
#include <fcntl.h>
#include <cerrno>

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

// Função para escapar caracteres JSON
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

// Função para log em JSON
void logEvent(const std::string& type, const std::string& message, 
              const std::string& component = "", const std::string& data = "") {
    
    std::cout << "{";
    std::cout << "\"timestamp\": \"" << getTimestamp() << "\",";
    std::cout << "\"type\": \"" << type << "\",";
    std::cout << "\"component\": \"" << component << "\",";
    std::cout << "\"message\": \"" << escapeJson(message) << "\"";
    
    if (!data.empty()) {
        std::cout << ",\"data\": \"" << escapeJson(data) << "\"";
    }
    
    std::cout << "}" << std::endl;
    std::cout.flush(); // Garante output imediato
}

// Estrutura para gerenciar o estado do cliente
struct ClientState {
    int sockfd;
    bool socket_created;
    bool connected;
    std::string server_path;
    
    ClientState() : sockfd(-1), socket_created(false), 
                   connected(false), server_path(SOCKET_PATH) {}
};

ClientState client_state;

// Função para criar socket
void createSocket() {
    if (client_state.socket_created) {
        logEvent("warning", "Socket já criado anteriormente", "client");
        return;
    }
    
    client_state.sockfd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (client_state.sockfd == -1) {
        logEvent("error", "Erro ao criar socket: " + std::string(strerror(errno)), "client");
        return;
    }
    
    client_state.socket_created = true;
    logEvent("socket", "Socket criado com sucesso", "client");
}

// Função para conectar ao servidor
void connectToServer() {
    if (!client_state.socket_created) {
        logEvent("error", "Socket não criado. Execute createSocket primeiro.", "client");
        return;
    }
    
    if (client_state.connected) {
        logEvent("warning", "Já conectado ao servidor", "client");
        return;
    }
    
    struct sockaddr_un server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sun_family = AF_UNIX;
    strncpy(server_addr.sun_path, client_state.server_path.c_str(), 
            sizeof(server_addr.sun_path) - 1);
    
    if (connect(client_state.sockfd, (struct sockaddr*)&server_addr, sizeof(server_addr)) == -1) {
        logEvent("error", "Erro ao conectar com servidor: " + std::string(strerror(errno)), "client");
        return;
    }
    
    client_state.connected = true;
    logEvent("connection", "Conectado ao servidor", "client", client_state.server_path);
}

// Função para enviar mensagem
void sendMessage(const std::string& message) {
    if (!client_state.connected) {
        logEvent("error", "Não conectado ao servidor", "client");
        return;
    }
    
    if (message.empty()) {
        logEvent("error", "Mensagem vazia", "client");
        return;
    }
    
    logEvent("send", "Enviando mensagem para servidor", "client", message);
    
    ssize_t bytes_sent = write(client_state.sockfd, message.c_str(), message.length());
    if (bytes_sent < 0) {
        logEvent("error", "Erro ao enviar mensagem: " + std::string(strerror(errno)), "client");
    } else {
        logEvent("send", "Mensagem enviada com sucesso", "client", 
                 "bytes=" + std::to_string(bytes_sent));
    }
}

// Função para receber resposta
void receiveResponse() {
    if (!client_state.connected) {
        logEvent("error", "Não conectado ao servidor", "client");
        return;
    }
    
    logEvent("receive", "Aguardando resposta do servidor", "client");
    
    // Configurar socket para não-bloqueante
    int flags = fcntl(client_state.sockfd, F_GETFL, 0);
    fcntl(client_state.sockfd, F_SETFL, flags | O_NONBLOCK);
    
    char buffer[BUFFER_SIZE];
    ssize_t bytes_read = read(client_state.sockfd, buffer, BUFFER_SIZE - 1);
    
    if (bytes_read > 0) {
        buffer[bytes_read] = '\0';
        std::string response(buffer);
        logEvent("receive", "Resposta recebida do servidor", "client", response);
    } 
    else if (bytes_read == 0) {
        logEvent("connection", "Servidor fechou a conexão", "client");
        client_state.connected = false;
    }
    else if (errno == EAGAIN || errno == EWOULDBLOCK) {
        logEvent("receive", "Nenhuma resposta disponível no momento", "client");
    }
    else {
        logEvent("error", "Erro ao receber resposta: " + std::string(strerror(errno)), "client");
    }
    
    // Restaurar modo bloqueante
    fcntl(client_state.sockfd, F_SETFL, flags);
}

// Função para fechar conexão
void closeConnection() {
    if (!client_state.socket_created) {
        logEvent("warning", "Socket não foi criado", "client");
        return;
    }
    
    if (client_state.connected) {
        logEvent("connection", "Fechando conexão com servidor", "client");
        close(client_state.sockfd);
        client_state.connected = false;
        logEvent("connection", "Conexão fechada", "client");
    } else {
        logEvent("warning", "Não estava conectado", "client");
    }
}

// Função para resetar completamente o cliente
void resetClient() {
    if (client_state.connected) {
        closeConnection();
    }
    
    if (client_state.socket_created) {
        close(client_state.sockfd);
    }
    
    // Resetar estado
    client_state.sockfd = -1;
    client_state.socket_created = false;
    client_state.connected = false;
    
    logEvent("system", "Cliente resetado", "client");
}

// Função para configurar caminho do servidor
void setServerPath(const std::string& path) {
    if (client_state.connected) {
        logEvent("error", "Não é possível mudar o caminho enquanto conectado", "client");
        return;
    }
    
    client_state.server_path = path;
    logEvent("config", "Caminho do servidor configurado", "client", path);
}

// Função principal com controle por comandos
int main() {
    logEvent("system", "Cliente Socket iniciado - Aguardando comandos", "client");
    logEvent("instruction", "Comandos disponíveis: create_socket, connect, send <message>, receive, close, reset, set_path <path>, exit", "client");
    
    std::string command;
    
    while (true) {
        // Ler comando do stdin
        if (!std::getline(std::cin, command)) {
            break;
        }
        
        // Processar comando
        if (command == "create_socket") {
            createSocket();
        }
        else if (command == "connect") {
            connectToServer();
        }
        else if (command.find("send ") == 0) {
            if (command.length() > 5) {
                std::string message = command.substr(5);
                sendMessage(message);
            } else {
                logEvent("error", "Comando send requer uma mensagem", "client");
            }
        }
        else if (command == "receive") {
            receiveResponse();
        }
        else if (command == "close") {
            closeConnection();
        }
        else if (command == "reset") {
            resetClient();
        }
        else if (command.find("set_path ") == 0) {
            if (command.length() > 9) {
                std::string path = command.substr(9);
                setServerPath(path);
            } else {
                logEvent("error", "Comando set_path requer um caminho", "client");
            }
        }
        else if (command == "exit") {
            logEvent("system", "Encerrando Cliente Socket", "client");
            break;
        }
        else if (!command.empty()) {
            logEvent("error", "Comando não reconhecido: " + command, "client");
        }
        
        // Pequena pausa
        usleep(10000); // 10ms
    }
    
    // Limpeza final
    if (client_state.connected) {
        closeConnection();
    }
    
    if (client_state.socket_created) {
        close(client_state.sockfd);
    }
    
    return 0;
}