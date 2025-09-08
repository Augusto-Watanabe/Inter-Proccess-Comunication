CC = g++
CFLAGS = -std=c++11 -Wall
TARGET_SERVER = server
TARGET_CLIENT = client
SOCKET_PATH = /tmp/demo_socket

all: $(TARGET_SERVER) $(TARGET_CLIENT)

$(TARGET_SERVER): server.cpp
	$(CC) $(CFLAGS) -o $(TARGET_SERVER) server.cpp

$(TARGET_CLIENT): client.cpp
	$(CC) $(CFLAGS) -o $(TARGET_CLIENT) client.cpp

clean:
	rm -f $(TARGET_SERVER) $(TARGET_CLIENT) $(SOCKET_PATH)

run-server: $(TARGET_SERVER)
	./$(TARGET_SERVER)

run-client: $(TARGET_CLIENT)
	@if [ -z "$(MSG)" ]; then \
		echo "Usage: make run-client MSG=\"sua mensagem aqui\""; \
	else \
		./$(TARGET_CLIENT) "$(MSG)"; \
	fi

.PHONY: all clean run-server run-client