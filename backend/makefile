CC = g++
CFLAGS = -std=c++11 -Wall

# Targets principais
all: pipes shared_memory sockets

# Build para cada categoria
pipes:
	$(MAKE) -C pipes

shared_memory:
	$(MAKE) -C shared_memory

sockets:
	$(MAKE) -C sockets

# Clean para tudo
clean:
	$(MAKE) -C pipes clean
	$(MAKE) -C shared_memory clean
	$(MAKE) -C sockets clean
	rm -f /tmp/demo_socket
	-ipcrm -a 2>/dev/null || true

.PHONY: all pipes shared_memory sockets clean