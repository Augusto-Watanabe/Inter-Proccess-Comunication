CC = g++
CFLAGS = -std=c++11 -Wall
TARGET = shared_memory

all: $(TARGET)

$(TARGET): shared_memory.cpp
	$(CC) $(CFLAGS) -o $(TARGET) shared_memory.cpp

clean:
	rm -f $(TARGET)
	ipcrm -a 2>/dev/null || true

run-writer:
	./$(TARGET) writer "Hello Shared Memory!"

run-reader:
	./$(TARGET) reader

run-cleaner:
	./$(TARGET) cleaner

.PHONY: all clean run-writer run-reader run-cleaner