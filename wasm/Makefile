OUT_DIR := ../src/wasm
C_SOURCES := core.c
CPP_SOURCES := bindings.cpp
HEADERS := core.h

EMFLAGS := \
	-lembind \
	-s MODULARIZE=1 \
	-s EXPORT_ES6=1 \
	-s ALLOW_MEMORY_GROWTH=1 \
	-O2

all: $(OUT_DIR)/core.js

$(OUT_DIR)/core.js: $(C_SOURCES) $(CPP_SOURCES) $(HEADERS)
	mkdir -p $(OUT_DIR)
	em++ $(C_SOURCES) $(CPP_SOURCES) -o $@ $(EMFLAGS)

debug: $(C_SOURCES) $(CPP_SOURCES) $(HEADERS)
	mkdir -p $(OUT_DIR)
	em++ $(C_SOURCES) $(CPP_SOURCES) -o $(OUT_DIR)/core.js $(EMFLAGS) -DCORE_DEBUG -O0

format:
	clang-format -i $(C_SOURCES) $(CPP_SOURCES) $(HEADERS)

tidy:
	clang-tidy $(C_SOURCES) -- -I.

clean:
	rm -rf $(OUT_DIR)

.PHONY: all format tidy clean
