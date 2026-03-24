#ifndef CORE_H
#define CORE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Placeholder for future Wasm-accelerated implementation.
   The layered decomposition algorithm currently runs in JavaScript
   (poc/layered-decompose.mjs). This file is kept so the Wasm build
   pipeline (Makefile, bindings.cpp) remains functional. */

int32_t placeholder(void);

#ifdef __cplusplus
}
#endif

#endif
