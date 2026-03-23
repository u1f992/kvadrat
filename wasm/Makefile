OUT_DIR := ../src/wasm
SOURCES := core.c
HEADERS := core.h

EMCC_FLAGS := \
	-s MODULARIZE=1 \
	-s EXPORT_ES6=1 \
	-s EXPORTED_FUNCTIONS='["_remove_bidirectional_edges","_build_polygons","_concat_polygons","_malloc","_free"]' \
	-s EXPORTED_RUNTIME_METHODS='["cwrap","HEAP32"]' \
	-s ALLOW_MEMORY_GROWTH=1 \
	-O2

all: $(OUT_DIR)/core.js

$(OUT_DIR)/core.js: $(SOURCES) $(HEADERS)
	mkdir -p $(OUT_DIR)
	emcc $(SOURCES) -o $@ $(EMCC_FLAGS)

format:
	clang-format -i $(SOURCES) $(HEADERS)

tidy:
	clang-tidy $(SOURCES) -- -I.

clean:
	rm -rf $(OUT_DIR)

.PHONY: all format tidy clean
