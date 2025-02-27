document.addEventListener('DOMContentLoaded', () => {
  // 저장된 설정 로드
  loadSettings();
  
  // // 번역 버튼 클릭 이벤트
  // document.getElementById('translateBtn').addEventListener('click', () => {
  //   chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  //     chrome.tabs.sendMessage(tabs[0].id, { action: "translatePage" });
  //   });
  // });
  
  // 설정 저장 버튼 클릭 이벤트
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
});

// 설정 저장
function saveSettings() {
  const settings = {
    apiKey: document.getElementById('apiKey').value,
    targetLang: document.getElementById('targetLang').value,
    autoTranslate: document.getElementById('autoTranslate').checked,
    features: {
      translateText: document.getElementById('translateText').checked,
      translateImage: document.getElementById('translateImage').checked,
      translateChart: document.getElementById('translateChart').checked
    }
  };
  
  chrome.storage.sync.set({ settings }, () => {
    // 저장 완료 표시
    const saveBtn = document.getElementById('saveSettings');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '저장됨!';
    
    setTimeout(() => {
      saveBtn.textContent = originalText;
    }, 1500);
  });
}

// 설정 로드
function loadSettings() {
  chrome.storage.sync.get('settings', data => {
    if (!data.settings) return;
    
    const { settings } = data;
    
    // 설정 값 적용
    document.getElementById('apiKey').value = settings.apiKey || '';
    document.getElementById('targetLang').value = settings.targetLang || 'ko';
    document.getElementById('autoTranslate').checked = settings.autoTranslate || false;
    
    // 기능 설정 적용
    if (settings.features) {
      document.getElementById('translateText').checked = settings.features.translateText !== false;
      document.getElementById('translateImage').checked = settings.features.translateImage || false;
      document.getElementById('translateChart').checked = settings.features.translateChart || false;
    }
  });
}