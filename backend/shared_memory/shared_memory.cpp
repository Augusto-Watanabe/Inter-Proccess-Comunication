#include <iostream>
#include <sys/ipc.h>
#include <sys/shm.h>
#include <sys/sem.h>
#include <sys/types.h>
#include <cstring>
#include <unistd.h>
#include <ctime>
#include <sstream>
#include <iomanip>
#include <string>
#include <cerrno>
#include <fcntl.h>

#define SHM_KEY 0x1234
#define SEM_KEY 0x5678
#define SHM_SIZE 1024

// Estrutura dos dados compartilhados
struct SharedData {
    char message[256];
    int counter;
    bool updated;
    pid_t last_writer;
    time_t last_update;
};

// Definição necessária para semctl
union semun {
    int val;
    struct semid_ds *buf;
    unsigned short *array;
};

// Função para obter timestamp
std::string getTimestamp() {
    std::time_t now = std::time(nullptr);
    std::tm* tm = std::localtime(&now);
    
    std::stringstream ss;
    ss << std::put_time(tm, "%Y-%m-%d %H:%M:%S");
    return ss.str();
}

// Função para escapar strings JSON
std::string escapeJson(const std::string& str) {
    std::string result;
    for (char c : str) {
        switch (c) {
            case '"': result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\b': result += "\\b"; break;
            case '\f': result += "\\f"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default: result += c; break;
        }
    }
    return result;
}

// Função para log JSON
void logEvent(const std::string& type, const std::string& message, 
              const std::string& process = "", pid_t pid = 0, 
              const std::string& data = "") {
    
    std::cout << "{";
    std::cout << "\"timestamp\": \"" << getTimestamp() << "\",";
    std::cout << "\"type\": \"" << type << "\",";
    std::cout << "\"process\": \"" << process << "\",";
    std::cout << "\"pid\": " << pid << ",";
    std::cout << "\"message\": \"" << escapeJson(message) << "\"";
    
    if (!data.empty()) {
        std::cout << ",\"data\": \"" << escapeJson(data) << "\"";
    }
    
    std::cout << "}" << std::endl;
    std::cout.flush();
}

// Função para exibir estado da memória em JSON
void displayMemoryState(SharedData* data, int shm_id, int sem_id) {
    int sem_val = semctl(sem_id, 0, GETVAL);
    
    std::cout << "{";
    std::cout << "\"timestamp\": \"" << getTimestamp() << "\",";
    std::cout << "\"type\": \"memory_state\",";
    std::cout << "\"shm_id\": " << shm_id << ",";
    std::cout << "\"sem_id\": " << sem_id << ",";
    std::cout << "\"memory\": {";
    std::cout << "\"message\": \"" << escapeJson(data->message) << "\",";
    std::cout << "\"counter\": " << data->counter << ",";
    std::cout << "\"updated\": " << (data->updated ? "true" : "false") << ",";
    std::cout << "\"last_writer\": " << data->last_writer << ",";
    std::cout << "\"last_update\": " << data->last_update;
    std::cout << "},";
    std::cout << "\"semaphore\": {";
    std::cout << "\"value\": " << sem_val << ",";
    std::cout << "\"available\": " << (sem_val > 0 ? "true" : "false");
    std::cout << "}";
    std::cout << "}" << std::endl;
    std::cout.flush();
}

// Estrutura para gerenciar o estado da memória compartilhada
struct SharedMemoryState {
    int shm_id;
    int sem_id;
    SharedData* shared_data;
    bool memory_created;
    bool semaphore_created;
    bool attached;
    pid_t writer_pid;
    pid_t reader_pid;
    
    SharedMemoryState() : shm_id(-1), sem_id(-1), shared_data(nullptr),
                         memory_created(false), semaphore_created(false),
                         attached(false), writer_pid(-1), reader_pid(-1) {}
};

SharedMemoryState shm_state;

// Funções para semáforos
void sem_lock(int sem_id) {
    struct sembuf sb = {0, -1, 0};
    semop(sem_id, &sb, 1);
}

void sem_unlock(int sem_id) {
    struct sembuf sb = {0, 1, 0};
    semop(sem_id, &sb, 1);
}

// Função para criar memória compartilhada e semáforo
void createSharedMemory() {
    if (shm_state.memory_created) {
        logEvent("warning", "Memória compartilhada já criada", "main", getpid());
        return;
    }
    
    // Criar/obter memória compartilhada
    shm_state.shm_id = shmget(SHM_KEY, SHM_SIZE, IPC_CREAT | 0666);
    if (shm_state.shm_id == -1) {
        logEvent("error", "Erro ao criar memória compartilhada: " + 
                 std::string(strerror(errno)), "main", getpid());
        return;
    }
    
    // Criar/obter semáforo
    shm_state.sem_id = semget(SEM_KEY, 1, IPC_CREAT | 0666);
    if (shm_state.sem_id == -1) {
        logEvent("error", "Erro ao criar semáforo: " + 
                 std::string(strerror(errno)), "main", getpid());
        return;
    }
    
    // Inicializar semáforo para 1 (disponível)
    if (semctl(shm_state.sem_id, 0, GETVAL) == 0) {
        union semun arg;
        arg.val = 1;
        semctl(shm_state.sem_id, 0, SETVAL, arg);
    }
    
    shm_state.memory_created = true;
    shm_state.semaphore_created = true;
    
    logEvent("shm", "Memória compartilhada e semáforo criados", "main", getpid(),
             "shm_id=" + std::to_string(shm_state.shm_id) + 
             " sem_id=" + std::to_string(shm_state.sem_id));
}

// Função para anexar à memória compartilhada
void attachToMemory() {
    if (!shm_state.memory_created) {
        logEvent("error", "Memória não criada. Execute createSharedMemory primeiro.", "main", getpid());
        return;
    }
    
    if (shm_state.attached) {
        logEvent("warning", "Já anexado à memória compartilhada", "main", getpid());
        return;
    }
    
    shm_state.shared_data = (SharedData*)shmat(shm_state.shm_id, NULL, 0);
    if (shm_state.shared_data == (void*)-1) {
        logEvent("error", "Erro ao anexar memória compartilhada: " + 
                 std::string(strerror(errno)), "main", getpid());
        return;
    }
    
    shm_state.attached = true;
    
    // Inicializar dados se for o primeiro
    sem_lock(shm_state.sem_id);
    if (shm_state.shared_data->counter == 0) {
        strcpy(shm_state.shared_data->message, "Memória inicializada");
        shm_state.shared_data->counter = 0;
        shm_state.shared_data->updated = false;
        shm_state.shared_data->last_writer = 0;
        shm_state.shared_data->last_update = time(nullptr);
        logEvent("shm", "Memória inicializada", "main", getpid());
    }
    sem_unlock(shm_state.sem_id);
    
    logEvent("shm", "Memória compartilhada anexada", "main", getpid());
}

// Função para escrever na memória compartilhada
void writeToMemory(const std::string& message) {
    if (!shm_state.attached) {
        logEvent("error", "Não anexado à memória compartilhada", "writer", getpid());
        return;
    }
    
    logEvent("operation", "Aguardando semáforo para escrita", "writer", getpid());
    
    sem_lock(shm_state.sem_id);
    logEvent("semaphore", "Semáforo obtido - escrevendo", "writer", getpid());
    
    // Escrever na memória compartilhada
    strncpy(shm_state.shared_data->message, message.c_str(), 
            sizeof(shm_state.shared_data->message) - 1);
    shm_state.shared_data->message[sizeof(shm_state.shared_data->message) - 1] = '\0';
    shm_state.shared_data->counter++;
    shm_state.shared_data->updated = true;
    shm_state.shared_data->last_writer = getpid();
    shm_state.shared_data->last_update = time(nullptr);
    
    logEvent("write", "Dados escritos na memória", "writer", getpid(), message);
    displayMemoryState(shm_state.shared_data, shm_state.shm_id, shm_state.sem_id);
    
    sem_unlock(shm_state.sem_id);
    logEvent("semaphore", "Semáforo liberado", "writer", getpid());
}

// Função para ler da memória compartilhada
void readFromMemory() {
    if (!shm_state.attached) {
        logEvent("error", "Não anexado à memória compartilhada", "reader", getpid());
        return;
    }
    
    logEvent("operation", "Aguardando semáforo para leitura", "reader", getpid());
    
    sem_lock(shm_state.sem_id);
    logEvent("semaphore", "Semáforo obtido - lendo", "reader", getpid());
    
    // Ler da memória compartilhada
    if (shm_state.shared_data->updated) {
        logEvent("read", "Dados lidos da memória", "reader", getpid(), 
                shm_state.shared_data->message);
        shm_state.shared_data->updated = false;
    } else {
        logEvent("read", "Nenhum dado novo", "reader", getpid());
    }
    
    displayMemoryState(shm_state.shared_data, shm_state.shm_id, shm_state.sem_id);
    
    sem_unlock(shm_state.sem_id);
    logEvent("semaphore", "Semáforo liberado", "reader", getpid());
}

// Função para limpar recursos
void cleanupMemory() {
    if (!shm_state.memory_created) {
        logEvent("warning", "Memória não foi criada", "cleaner", getpid());
        return;
    }
    
    logEvent("operation", "Iniciando limpeza de recursos", "cleaner", getpid());
    
    sem_lock(shm_state.sem_id);
    
    // Remover memória compartilhada
    if (shmctl(shm_state.shm_id, IPC_RMID, NULL) == 0) {
        logEvent("shm", "Memória compartilhada removida", "cleaner", getpid());
        shm_state.memory_created = false;
    } else {
        logEvent("error", "Erro ao remover memória: " + 
                 std::string(strerror(errno)), "cleaner", getpid());
    }
    
    // Remover semáforo
    if (semctl(shm_state.sem_id, 0, IPC_RMID) == 0) {
        logEvent("semaphore", "Semáforo removido", "cleaner", getpid());
        shm_state.semaphore_created = false;
    } else {
        logEvent("error", "Erro ao remover semáforo: " + 
                 std::string(strerror(errno)), "cleaner", getpid());
    }
    
    sem_unlock(shm_state.sem_id);
    
    shm_state.attached = false;
    shm_state.shared_data = nullptr;
}

// Função para desanexar da memória
void detachFromMemory() {
    if (!shm_state.attached) {
        logEvent("warning", "Não estava anexado à memória", "main", getpid());
        return;
    }
    
    if (shmdt(shm_state.shared_data) == 0) {
        logEvent("shm", "Memória compartilhada desanexada", "main", getpid());
        shm_state.attached = false;
        shm_state.shared_data = nullptr;
    } else {
        logEvent("error", "Erro ao desanexar memória: " + 
                 std::string(strerror(errno)), "main", getpid());
    }
}

// Função para resetar completamente
void resetSharedMemory() {
    if (shm_state.attached) {
        detachFromMemory();
    }
    
    if (shm_state.memory_created && shm_state.semaphore_created) {
        cleanupMemory();
    }
    
    // Resetar estado
    shm_state.shm_id = -1;
    shm_state.sem_id = -1;
    shm_state.shared_data = nullptr;
    shm_state.memory_created = false;
    shm_state.semaphore_created = false;
    shm_state.attached = false;
    
    logEvent("system", "Estado da memória compartilhada resetado", "main", getpid());
}

// Função principal com controle por comandos
int main() {
    logEvent("system", "Shared Memory Manager iniciado - Aguardando comandos", "main", getpid());
    logEvent("instruction", "Comandos disponíveis: create, attach, write <message>, read, detach, cleanup, reset, exit", "main", getpid());
    
    std::string command;
    
    while (true) {
        // Ler comando do stdin
        if (!std::getline(std::cin, command)) {
            break;
        }
        
        // Processar comando
        if (command == "create") {
            createSharedMemory();
        }
        else if (command == "attach") {
            attachToMemory();
        }
        else if (command.find("write ") == 0) {
            if (command.length() > 6) {
                std::string message = command.substr(6);
                writeToMemory(message);
            } else {
                logEvent("error", "Comando write requer uma mensagem", "main", getpid());
            }
        }
        else if (command == "read") {
            readFromMemory();
        }
        else if (command == "detach") {
            detachFromMemory();
        }
        else if (command == "cleanup") {
            cleanupMemory();
        }
        else if (command == "reset") {
            resetSharedMemory();
        }
        else if (command == "exit") {
            logEvent("system", "Encerrando Shared Memory Manager", "main", getpid());
            break;
        }
        else if (!command.empty()) {
            logEvent("error", "Comando não reconhecido: " + command, "main", getpid());
        }
        
        // Pequena pausa
        usleep(10000); // 10ms
    }
    
    // Limpeza final
    if (shm_state.attached) {
        detachFromMemory();
    }
    
    if (shm_state.memory_created && shm_state.semaphore_created) {
        cleanupMemory();
    }
    
    return 0;
}