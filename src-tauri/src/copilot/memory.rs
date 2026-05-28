use std::collections::VecDeque;

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
        self.data.push_str(text);
        while self.data.len() > self.max_chars {
            let excess = self.data.len() - self.max_chars;
            let _ = self.data.drain(..excess);
        }
    }

    pub fn content(&self) -> &str {
        &self.data
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn clear(&mut self) {
        self.data.clear();
    }
}
