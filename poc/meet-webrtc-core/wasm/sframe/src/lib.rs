//! wasm-sframe — SFrame RFC 9605 WASM bindings for browser
//! Target: 150KB gzipped WASM, VideoFrame recycling

use wasm_bindgen::prelude::*;
use sframe::{SFrame, CipherSuite, KeyProvider};
use aes_gcm::{Aes256Gcm, KeyInit};
use ctr::cipher::{KeyIvInit, StreamCipher};
use zeroize::Zeroize;

#[wasm_bindgen]
pub struct WasmSFrame {
    sframe: SFrame<Aes256Gcm>,
    key_cache: Vec<u8>,
}

#[wasm_bindgen]
impl WasmSFrame {
    #[wasm_bindgen(constructor)]
    pub fn new(cipher_suite: u8, key: &[u8]) -> Result<WasmSFrame, JsValue> {
        let suite = match cipher_suite {
            0 => CipherSuite::AES_GCM_256,
            _ => return Err(JsValue::from_str("Unsupported cipher suite")),
        };

        if key.len() != 32 {
            return Err(JsValue::from_str("Key must be 32 bytes"));
        }

        let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let sframe = SFrame::new(suite, cipher);

        Ok(WasmSFrame {
            sframe,
            key_cache: key.to_vec(),
        })
    }

    #[wasm_bindgen]
    pub fn encrypt(&mut self, frame: &[u8], kid: u64, counter: u64) -> Result<Vec<u8>, JsValue> {
        let mut output = Vec::with_capacity(frame.len() + 32);
        self.sframe
            .encrypt(frame, kid, counter, &mut output)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(output)
    }

    #[wasm_bindgen]
    pub fn decrypt(&mut self, frame: &[u8], kid: u64, counter: u64) -> Result<Vec<u8>, JsValue> {
        let mut output = Vec::with_capacity(frame.len());
        self.sframe
            .decrypt(frame, kid, counter, &mut output)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(output)
    }

    #[wasm_bindgen]
    pub fn rotate_key(&mut self, new_key: &[u8]) -> Result<(), JsValue> {
        if new_key.len() != 32 {
            return Err(JsValue::from_str("Key must be 32 bytes"));
        }
        let cipher = Aes256Gcm::new_from_slice(new_key).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.sframe = SFrame::new(CipherSuite::AES_GCM_256, cipher);
        self.key_cache.copy_from_slice(new_key);
        self.key_cache.zeroize();
        Ok(())
    }
}

#[wasm_bindgen]
pub fn get_cipher_suite_aes_gcm_256() -> u8 {
    0
}

#[wasm_bindgen]
pub fn generate_key() -> Vec<u8> {
    let mut key = [0u8; 32];
    getrandom::getrandom(&mut key).expect("getrandom failed");
    key.to_vec()
}