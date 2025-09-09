CC = g++
CFLAGS = -std=c++11 -Wall
TARGETS = server client

all: $(TARGETS)

server: server.cpp
	$(CC) $(CFLAGS) -o server server.cpp

client: client.cpp
	$(CC) $(CFLAGS) -o client client.cpp

clean:
	rm -f $(TARGETS)

.PHONY: all clean