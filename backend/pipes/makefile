CC = g++
CFLAGS = -std=c++11 -Wall
TARGET = pipe_monitor

all: $(TARGET)

$(TARGET): pipe_monitor.cpp
	$(CC) $(CFLAGS) -o $(TARGET) pipe_monitor.cpp

clean:
	rm -f $(TARGET)

.PHONY: all clean