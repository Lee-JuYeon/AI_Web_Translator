// popup/popup.js

// 문서가 로드되면 실행
document.addEventListener('DOMContentLoaded', async function() {
  // 사용량 관리자 모듈 가져오기
  // utils/usage-manager.js가 manifest.json의 content_scripts에 포함되어 있지만
  // popup에서는 직접 로드해야 함
  let usageManager;
  
  try {
    // 백그라운드 페이지에서 UsageManager 객체 접근 시도
    const backgroundPage = chrome.extension.getBackgroundPage();
    if (backgroundPage && backgroundPage.UsageManager) {
      usageManager = backgroundPage.UsageManager;
    } else {
      // 백그라운드 페이지에서 접근할 수 없는 경우 대체 방법
      // 이 경우 popup.html에 <script src="../utils/usage-manager.js"></script>를 추가해야 함
      usageManager = window.UsageManager;
    }
    
    if (!usageManager) {
      throw new Error('UsageManager를 찾을 수 없습니다');
    }
    
    // 사용량 통계 가져오기
    const stats = await usageManager.getUsageStats();
    
    // 사용량 UI 업데이트
    updateUsageUI(stats);
  } catch (error) {
    console.error("UsageManager 접근 오류:", error);
    // 오류 발생 시 기본 UI 표시
    updateUsageUI({
      subscription: 'FREE',
      tokensUsed: 0,
      limit: 15000,
      remaining: 15000,
      percentage: 0,
      lastReset: new Date().toISOString()
    });
  }
  
  // 현재 페이지 번역 버튼 이벤트 리스너
  document.getElementById('translateButton').addEventListener('click', function() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "translatePage" });
      window.close(); // 팝업 닫기
    });
  });
  
  // 업그레이드 버튼 이벤트 리스너
  document.getElementById('upgradeButton').addEventListener('click', function() {
    // 결제 페이지로 이동
    chrome.tabs.create({ url: 'https://your-payment-page.com' });
  });
  
  // 설정 저장 버튼 이벤트 리스너
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  
  // 개인정보처리방침 링크
  document.getElementById('privacyLink').addEventListener('click', function(e) {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://your-website.com/privacy' });
  });
  
  // 도움말 링크
  document.getElementById('helpLink').addEventListener('click', function(e) {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://your-website.com/help' });
  });
  
  // 저장된 설정 로드
  loadSettings();
});

// 설정 저장 함수
function saveSettings() {
  const settings = {
    targetLang: document.getElementById('targetLang').value,
    autoTranslate: document.getElementById('autoTranslate').checked,
    features: {
      translateText: document.getElementById('translateText').checked,
      translateImage: document.getElementById('translateImage').checked
    }
  };
  
  chrome.storage.sync.set({ settings }, function() {
    // 저장 완료 표시
    const saveBtn = document.getElementById('saveSettings');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '저장됨!';
    
    setTimeout(() => {
      saveBtn.textContent = originalText;
    }, 1500);
  });
}

// 저장된 설정 로드 함수
function loadSettings() {
  chrome.storage.sync.get('settings', data => {
    if (!data.settings) return;
    
    const { settings } = data;
    
    // 설정 값 적용
    document.getElementById('targetLang').value = settings.targetLang || 'ko';
    document.getElementById('autoTranslate').checked = settings.autoTranslate || false;
    
    // 기능 설정 적용
    if (settings.features) {
      document.getElementById('translateText').checked = settings.features.translateText !== false;
      if (document.getElementById('translateImage')) {
        document.getElementById('translateImage').checked = settings.features.translateImage || false;
      }
    }
  });
}

// 사용량 UI 업데이트 함수
function updateUsageUI(stats) {
  // 등급 표시
  const subscriptionElement = document.getElementById('subscription-level');
  if (subscriptionElement) {
    let subscriptionName = "무료";
    if (stats.subscription === 'BASIC') subscriptionName = "기본 ($5/월)";
    if (stats.subscription === 'PREMIUM') subscriptionName = "프리미엄 ($10/월)";
    
    subscriptionElement.textContent = subscriptionName;
  }
  
  // 프로그레스 바 업데이트
  const progressBar = document.getElementById('usage-progress');
  if (progressBar) {
    if (stats.subscription === 'PREMIUM') {
      progressBar.style.width = '100%';
      progressBar.style.backgroundColor = '#4CAF50';
    } else {
      progressBar.style.width = `${stats.percentage}%`;
      
      // 경고 색상 (80% 이상이면 주황색, 95% 이상이면 빨간색)
      if (stats.percentage >= 95) {
        progressBar.style.backgroundColor = '#f44336';
      } else if (stats.percentage >= 80) {
        progressBar.style.backgroundColor = '#ff9800';
      } else {
        progressBar.style.backgroundColor = '#2196F3';
      }
    }
  }
  
  // 사용량 텍스트 업데이트
  const usageText = document.getElementById('usage-text');
  if (usageText) {
    if (stats.subscription === 'PREMIUM') {
      usageText.textContent = `무제한 사용 가능`;
    } else {
      usageText.textContent = `${stats.tokensUsed.toLocaleString()} / ${stats.limit.toLocaleString()} 토큰 사용`;
    }
  }
  
  // 남은 양 업데이트
  const remainingText = document.getElementById('remaining-text');
  if (remainingText) {
    if (stats.subscription === 'PREMIUM') {
      remainingText.textContent = '무제한';
    } else {
      remainingText.textContent = `남은 토큰: ${stats.remaining.toLocaleString()}`;
    }
  }
  
  // 다음 리셋 날짜 표시
  const resetText = document.getElementById('reset-date');
  if (resetText) {
    const resetDate = new Date(stats.lastReset);
    resetDate.setMonth(resetDate.getMonth() + 1);
    
    const formattedDate = `${resetDate.getFullYear()}년 ${resetDate.getMonth() + 1}월 ${resetDate.getDate()}일`;
    resetText.textContent = `다음 리셋: ${formattedDate}`;
  }
  
  // 프리미엄 기능 상태 업데이트
  const translateImageCheckbox = document.getElementById('translateImage');
  if (translateImageCheckbox) {
    translateImageCheckbox.disabled = stats.subscription !== 'PREMIUM';
    
    // 프리미엄 기능의 레이블에 disabled 클래스 추가/제거
    const translateImageLabel = translateImageCheckbox.nextElementSibling;
    if (translateImageLabel) {
      if (stats.subscription === 'PREMIUM') {
        translateImageLabel.classList.remove('disabled-text');
      } else {
        translateImageLabel.classList.add('disabled-text');
      }
    }
  }
}