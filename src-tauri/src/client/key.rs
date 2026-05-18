use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    ChaCha20Poly1305,
    Key
};
use serde::{Deserialize, Serialize};
use super::common::{VaultError,SshCredential};
use russh::keys::{PublicKey, PublicKeyBase64};
use russh::keys::{load_secret_key,PrivateKey};
use std::path::PathBuf;
use bcrypt::{DEFAULT_COST, hash, verify,bcrypt};
use crate::FAO_SERVICES;
pub enum KnownHostValidationResult {
    Valid,
    Invalid,
    Unknown,
}

pub async fn validate(server_name: &str, user_password: &str, server_key: &PublicKey) -> Result<KnownHostValidationResult, VaultError> {
    let known_key = FAO_SERVICES
        .lock()
        .await
        .config
        .get_server(server_name);
    let key_base64 = server_key.public_key_base64();

    match known_key {
        Some(sc) => {
            match sc.server_public_key {
                Some(encrypted_spk) => {
                    let decrypted = decrypt_server_public_key(user_password, &encrypted_spk)
                        .map_err(|_| VaultError::NotFound)?;
                    if decrypted == key_base64 {
                        Ok(KnownHostValidationResult::Valid)
                    } else {
                        Ok(KnownHostValidationResult::Invalid)
                    }
                }
                None => Ok(KnownHostValidationResult::Unknown),
            }
        }
        None => Ok(KnownHostValidationResult::Unknown),
    }
}

pub fn encrypt_server_public_key(user_password: &str, key_base64: &str) -> Result<String, anyhow::Error> {
    server_password_into_secret(user_password, key_base64)
}

pub fn decrypt_server_public_key(user_password: &str, secret: &str) -> Result<String, anyhow::Error> {
    let hash_key = get_server_hash_key(user_password, secret)?;
    let encrypted = EncryptedPassword::new(secret)?;
    encrypted.decrypt(&hash_key)
}


pub fn load_keys(
	path: String,
) -> Result<Vec<PrivateKey>, russh::keys::Error> {
    let path = PathBuf::from(path);
    Ok(vec![
        load_secret_key(&path, None)?,
        load_secret_key(&path, None)?,
    ])
}
// 密码是用户密码，初次设置 -> 盐 + hash key
pub fn set_server_hash_key(user_password: &str) -> Result<String, anyhow::Error> {
    let salt: [u8; 16] = rand::random();
    let hashed_bytes = bcrypt(DEFAULT_COST, salt, user_password.as_bytes());
    // let combined_hex = format!("{}{}", hex::encode(salt), hex::encode(hashed_bytes));
    let hex_str = hex::encode(hashed_bytes);
    Ok(format!("{}{}",hex::encode(salt),hex_str))
}
// 密码是用户密码， secret = 盐 + server password 的密文
pub fn get_server_hash_key(user_password: &str,secret: &str) -> Result<String, anyhow::Error>{
    let (salt_hex_part, _passwd_crypt) = secret.split_at(32);
    // 还原盐
    let restored_salt_vec = hex::decode(salt_hex_part)?;
    let mut restored_salt = [0u8; 16];
    restored_salt.copy_from_slice(&restored_salt_vec);
    let hashed_bytes = bcrypt(DEFAULT_COST, restored_salt, user_password.as_bytes());
    // let combined_hex = format!("{}{}", hex::encode(restored_salt), hex::encode(hashed_bytes));
    let hex_str = hex::encode(hashed_bytes);
    Ok(hex_str)
}

pub fn server_password_into_secret(user_password: &str,server_password: &str) -> Result<String, anyhow::Error>{
    let salt_and_hashkey = set_server_hash_key(user_password)?;
    let (salt,hash_key) = salt_and_hashkey.split_at(32);
    let encry_passwd = EncryptedPassword::encrypt(server_password, hash_key)?;
    let encry_str = hex::encode(encry_passwd.secret_data);
    let secret = format!("{}{}",salt,encry_str);
    Ok(secret)
}

// server 密码定义
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EncryptedPassword {
    pub secret_data: Vec<u8> 
}

impl EncryptedPassword {
    pub fn new(secret: &str) -> Result<Self, anyhow::Error>{// 辅助方法,config中的secret是string，通过string构造self 从而解密，待优化
        let s = hex::decode(secret)?;
        if s.len() < 16 {
            return Err(anyhow::anyhow!("Hex data too short, need at least 16 bytes"));
        }
        Ok(Self { secret_data: s[16..].to_vec() })
    }


    pub fn encrypt(server_passwd: &str,key: &str) -> Result<Self, anyhow::Error> {
        let last_32 = &key[key.len() - 32..];
        let key = last_32.as_bytes();
        // let key: &[u8; 32] = b"39ZZ1Eyl6GK2P6VdxoUcSr9Ov25kBGjD";

        let key = Key::from_slice(key);
        let cipher = ChaCha20Poly1305::new(&key);
        let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
        let ciphertext = cipher.encrypt(&nonce, server_passwd.as_bytes())
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;
        let mut combined = nonce.to_vec();
        combined.extend_from_slice(&ciphertext);
        Ok(Self { secret_data: combined })
    }

    pub fn decrypt(&self,key: &str) -> Result<String, anyhow::Error> {
        let last_32 = &key[key.len() - 32..];
        let key = last_32.as_bytes();
        let key = Key::from_slice(key);
        let cipher = ChaCha20Poly1305::new(&key);
        if self.secret_data.len() < 12 {
            return Err(anyhow::anyhow!("secretdata's len error"));
        }
        let (nonce_slice, ciphertext) = self.secret_data.split_at(12);
        let nonce = chacha20poly1305::Nonce::from_slice(nonce_slice);
        let plaintext_bytes = cipher.decrypt(nonce, ciphertext)
            .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;
        String::from_utf8(plaintext_bytes).map_err(|e| e.into())
    }
}