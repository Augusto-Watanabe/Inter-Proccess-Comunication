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

// Funções para semáforos
void sem_lock(int sem_id) {
    struct sembuf sb = {0, -1, 0};
    semop(sem_id, &sb, 1);
}

void sem_unlock(int sem_id) {
    struct sembuf sb = {0, 1, 0};
    semop(sem_id, &sb, 1);
}

// Função para timestamp
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
}

// Função para exibir estado da memória em JSON
void displayMemoryState(SharedData* data, int shm_id, int sem_id) {
    int sem_val = semctl(sem_id, 0, GETVAL);
    
    std::cout << "{";
    std::cout << "\"timestamp\": \"" << getTimestamp() << "\",";
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
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Uso: " << argv[0] << " <writer|reader|cleaner> [mensagem]" << std::endl;
        return 1;
    }
    
    std::string mode = argv[1];
    pid_t my_pid = getpid();
    
    logEvent("system", "Processo iniciado", mode, my_pid);
    
    // Criar/obter memória compartilhada
    int shm_id = shmget(SHM_KEY, SHM_SIZE, IPC_CREAT | 0666);
    if (shm_id == -1) {
        logEvent("error", "Erro ao criar memória compartilhada", mode, my_pid);
        return 1;
    }
    logEvent("shm", "Memória compartilhada obtida", mode, my_pid, std::to_string(shm_id));
    
    // Anexar memória compartilhada
    SharedData* shared_data = (SharedData*)shmat(shm_id, NULL, 0);
    if (shared_data == (void*)-1) {
        logEvent("error", "Erro ao anexar memória compartilhada", mode, my_pid);
        return 1;
    }
    logEvent("shm", "Memória compartilhada anexada", mode, my_pid);
    
    // Criar/obter semáforo
    int sem_id = semget(SEM_KEY, 1, IPC_CREAT | 0666);
    if (sem_id == -1) {
        logEvent("error", "Erro ao criar semáforo", mode, my_pid);
        shmdt(shared_data);
        return 1;
    }
    
    // Inicializar semáforo para 1 (disponível)
    if (semctl(sem_id, 0, GETVAL) == 0) {
        union semun {
            int val;
            struct semid_ds *buf;
            unsigned short *array;
        } arg;
        arg.val = 1;
        semctl(sem_id, 0, SETVAL, arg);
    }
    logEvent("semaphore", "Semáforo obtido", mode, my_pid, std::to_string(sem_id));
    
    if (mode == "writer") {
        // Processo escritor
        if (argc < 3) {
            std::cerr << "Escritor precisa de uma mensagem" << std::endl;
            shmdt(shared_data);
            return 1;
        }
        
        std::string message = argv[2];
        
        for (int i = 0; i < 3; ++i) {
            logEvent("operation", "Aguardando semáforo para escrita", "writer", my_pid);
            
            sem_lock(sem_id);
            logEvent("semaphore", "Semáforo obtido - escrevendo", "writer", my_pid);
            
            // Escrever na memória compartilhada
            strncpy(shared_data->message, message.c_str(), sizeof(shared_data->message) - 1);
            shared_data->message[sizeof(shared_data->message) - 1] = '\0';
            shared_data->counter++;
            shared_data->updated = true;
            shared_data->last_writer = my_pid;
            shared_data->last_update = time(nullptr);
            
            logEvent("write", "Dados escritos na memória", "writer", my_pid, message);
            std::cout << "MEMORY_STATE: ";
            displayMemoryState(shared_data, shm_id, sem_id);
            
            sleep(2); // Manter o lock por alguns segundos
            
            sem_unlock(sem_id);
            logEvent("semaphore", "Semáforo liberado", "writer", my_pid);
            
            sleep(1); // Esperar antes da próxima escrita
        }
        
    } else if (mode == "reader") {
        // Processo leitor
        for (int i = 0; i < 5; ++i) {
            logEvent("operation", "Aguardando semáforo para leitura", "reader", my_pid);
            
            sem_lock(sem_id);
            logEvent("semaphore", "Semáforo obtido - lendo", "reader", my_pid);
            
            // Ler da memória compartilhada
            if (shared_data->updated) {
                logEvent("read", "Dados lidos da memória", "reader", my_pid, shared_data->message);
                shared_data->updated = false;
            } else {
                logEvent("read", "Nenhum dado novo", "reader", my_pid);
            }
            
            std::cout << "MEMORY_STATE: ";
            displayMemoryState(shared_data, shm_id, sem_id);
            
            sem_unlock(sem_id);
            logEvent("semaphore", "Semáforo liberado", "reader", my_pid);
            
            sleep(1); // Esperar antes da próxima leitura
        }
        
    } else if (mode == "cleaner") {
        // Processo de limpeza
        sem_lock(sem_id);
        
        // Remover memória compartilhada
        shmctl(shm_id, IPC_RMID, NULL);
        logEvent("shm", "Memória compartilhada removida", "cleaner", my_pid);
        
        // Remover semáforo
        semctl(sem_id, 0, IPC_RMID);
        logEvent("semaphore", "Semáforo removido", "cleaner", my_pid);
        
        sem_unlock(sem_id);
        
    } else {
        std::cerr << "Modo inválido: " << mode << std::endl;
        shmdt(shared_data);
        return 1;
    }
    
    // Desanexar memória compartilhada (exceto no cleaner que já removeu)
    if (mode != "cleaner") {
        shmdt(shared_data);
        logEvent("shm", "Memória compartilhada desanexada", mode, my_pid);
    }
    
    logEvent("system", "Processo finalizado", mode, my_pid);
    return 0;
}

// Definição necessária para semctl
union semun {
    int val;
    struct semid_ds *buf;
    unsigned short *array;
};