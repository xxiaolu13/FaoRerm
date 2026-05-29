use std::sync::Mutex;
use uuid::Uuid;
use std::sync::Arc;

pub struct RingBuffer {
    data: String,
    max_chars: usize,
}

impl RingBuffer {
    pub fn new(max_chars: usize) -> Self {
        Self {
            data: String::with_capacity(max_chars),
            max_chars,
        }
    }

    pub fn append(&mut self, text: &str) {
        for ch in text.chars() {
            match ch {
                '\r' => {
                    if let Some(pos) = self.data.rfind('\n') {
                        self.data.truncate(pos + 1);
                    } else {
                        self.data.clear();
                    }
                }
                '\x08' => {
                    self.data.pop();
                }
                '\x07' => {}
                _ => {
                    self.data.push(ch);
                }
            }
        }
        while self.data.len() > self.max_chars {
            if let Some(pos) = self.data.find('\n') {
                let _ = self.data.drain(..pos + 1);
            } else {
                self.data.clear();
            }
        }
    }

    pub fn content(&self) -> &str {
        &self.data
    }
}

pub struct SessionRecordings {
    buffers: dashmap::DashMap<Uuid, Arc<Mutex<RingBuffer>>>,
}

impl SessionRecordings {
    pub fn new() -> Self {
        Self {
            buffers: dashmap::DashMap::new(),
        }
    }

    pub fn register(&self, channel_id: Uuid) {
        self.buffers.insert(channel_id, Arc::new(Mutex::new(RingBuffer::new(50_000))));
    }

    pub fn unregister(&self, channel_id: &Uuid) {
        self.buffers.remove(channel_id);
    }

    pub fn append(&self, channel_id: &Uuid, text: &str) {
        if let Some(buf) = self.buffers.get(channel_id) {
            if let Ok(mut guard) = buf.lock() {
                guard.append(text);
            }
        }
    }

    pub fn get_content(&self, channel_id: &Uuid) -> Option<String> {
        self.buffers.get(channel_id).and_then(|buf| {
            buf.lock().ok().map(|guard| guard.content().to_string())
        })
    }
}
