export const notepadApp = {
  init(body) {
    const notepad = body.querySelector('#notepad');
    const charCount = body.querySelector('#charCount');
    const status = body.querySelector('#status');
    const clearBtn = body.querySelector('#clearBtn');
    const timestampBtn = body.querySelector('#timestampBtn');
    
    if (!notepad || !charCount || !status) return;
    
    // Update character count
    const updateCharCount = () => {
      const count = notepad.value.length;
      charCount.textContent = `${count} character${count !== 1 ? 's' : ''}`;
    };
    
    notepad.addEventListener('input', updateCharCount);
    
    // Clear note
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Clear all content?')) {
          notepad.value = '';
          updateCharCount();
        }
      });
    }
    
    // Insert timestamp
    if (timestampBtn) {
      timestampBtn.addEventListener('click', () => {
        const timestamp = new Date().toLocaleString();
        const pos = notepad.selectionStart;
        const text = notepad.value;
        notepad.value = text.slice(0, pos) + `[${timestamp}] ` + text.slice(pos);
        notepad.focus();
        notepad.setSelectionRange(pos + timestamp.length + 3, pos + timestamp.length + 3);
        updateCharCount();
      });
    }
    
    // Initialize character count
    updateCharCount();
  }
};
