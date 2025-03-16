// popup/popup.js - 최적화된 버전
let languages = []; // 언어 리스트 저장용 변수

// 문서가 로드되면 실행
document.addEventListener('DOMContentLoaded', async function() {
  try {
    // 필요한 모듈 확인
    checkRequiredModules();
    
    // 언어 리스트 로드
    await loadLanguages();
    
    // 사용량 통계 가져오기
    const stats = await getUsageStats();
    
    // 사용량 UI 업데이트
    updateUsageUI(stats);
    
    // 이벤트 리스너 설정
    setupEventListeners();
    
    // 저장된 설정 로드
    loadSettings();
  } catch (error) {
    console.error("초기화 오류:", error);
    updateUIWithDefaultValues();
  }
});

/**
 * 언어 리스트 로드 함수
 */
async function loadLanguages() {
  try {
    const response = await fetch('../languages.json');
    const data = await response.json();
    languages = data.languages || [];
    
    // 언어 선택 드롭다운 채우기
    const targetLangSelect = document.getElementById('targetLang');
    if (targetLangSelect) {
      // 기존 옵션 제거
      targetLangSelect.innerHTML = '';
      
      // 새 옵션 추가
      languages.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang.code;
        option.textContent = lang.native; // 원어 이름 사용
        targetLangSelect.appendChild(option);
      });
    }
  } catch (error) {
    console.error("언어 리스트 로드 오류:", error);
    // 오류 시 기본 옵션 추가
    const targetLangSelect = document.getElementById('targetLang');
    if (targetLangSelect) {
      targetLangSelect.innerHTML = '<option value="ko">한국어</option>';
    }
  }
}

/**
 * 필요한 모듈 체크
 */
function checkRequiredModules() {
  const requiredModules = ['TranslatorService', 'UsageManager', 'UIManager', 'CacheManager'];
  
  for (const moduleName of requiredModules) {
    if (!window[moduleName]) {
      console.error(`필요한 모듈이 로드되지 않았습니다: ${moduleName}`);
    }
  }
}

/**
 * 기본값으로 UI 업데이트 (오류 발생 시)
 */
function updateUIWithDefaultValues() {
  const defaultStats = {
    subscription: 'FREE',
    tokensUsed: 0,
    limit: 15000,
    remaining: 15000,
    percentage: 0
  };
  
  updateUsageUI(defaultStats);
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
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
  
  // 번역 언어 변경 이벤트 리스너
  document.getElementById('targetLang').addEventListener('change', function() {
    saveSettings();
  });
  
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
}

/**
 * 설정 저장 함수
 */
function saveSettings() {
  const settings = {
    targetLang: document.getElementById('targetLang').value
  };
  
  chrome.storage.sync.set({ settings }, function() {
    // 저장된 설정을 활성 탭에 전달
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { 
        action: "updateSettings", 
        settings: settings 
      });
    });
  });
}

/**
 * 저장된 설정 로드 함수
 */
function loadSettings() {
  chrome.storage.sync.get('settings', data => {
    if (!data.settings) return;
    
    const { settings } = data;
    
    // 설정 값 적용
    const targetLangSelect = document.getElementById('targetLang');
    
    if (settings.targetLang) {
      // 해당 언어 옵션이 존재하는지 확인
      const optionExists = Array.from(targetLangSelect.options).some(
        option => option.value === settings.targetLang
      );
      
      if (optionExists) {
        targetLangSelect.value = settings.targetLang;
      }
    }
  });
}

/**
 * 사용량 통계 가져오기
 */
async function getUsageStats() {
  return new Promise((resolve, reject) => {
    try {
      if (window.UsageManager && typeof window.UsageManager.getUsageStats === 'function') {
        window.UsageManager.getUsageStats()
          .then(stats => resolve(stats))
          .catch(err => {
            console.error("사용량 통계 가져오기 오류:", err);
            reject(err);
          });
      } else {
        chrome.runtime.sendMessage({ action: "getUsageStats" }, function(response) {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          
          if (response && response.usage) {
            const usage = response.usage;
            const subscription = response.subscription || 'FREE';
            
            const limit = getSubscriptionLimit(subscription);
            const tokensUsed = usage.tokensUsed || 0;
            const remaining = Math.max(0, limit - tokensUsed);
            const percentage = limit > 0 ? Math.min(100, Math.round((tokensUsed / limit) * 100)) : 0;
            
            resolve({
              subscription,
              tokensUsed,
              limit,
              remaining,
              percentage
            });
          } else {
            reject(new Error("사용량 데이터가 없습니다"));
          }
        });
      }
    } catch (error) {
      console.error("사용량 통계 요청 오류:", error);
      reject(error);
    }
  });
}

/**
 * 구독 등급에 따른 토큰 한도 가져오기
 */
function getSubscriptionLimit(subscription) {
  switch (subscription) {
    case 'BASIC':
      return 100000;
    case 'FREE':
    default:
      return 15000;
  }
}

/**
 * 사용량 UI 업데이트 함수
 */
function updateUsageUI(stats) {
  // 등급 표시
  const subscriptionElement = document.getElementById('subscription-level');
  if (subscriptionElement) {
    let subscriptionName;
    
    switch (stats.subscription) {
      case 'BASIC':
        subscriptionName = "기본 ($5/월)";
        break;
      case 'FREE':
      default:
        subscriptionName = "무료";
    }
    
    subscriptionElement.textContent = subscriptionName;
  }
  
  // 프로그레스 바 업데이트
  const progressBar = document.getElementById('usage-progress');
  if (progressBar) {
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
  
  // 사용량 텍스트 업데이트
  const usageText = document.getElementById('usage-text');
  if (usageText) {
    usageText.textContent = `${stats.tokensUsed.toLocaleString()} / ${stats.limit.toLocaleString()} 토큰 사용`;
  }
  
  // 남은 양 업데이트
  const remainingText = document.getElementById('remaining-text');
  if (remainingText) {
    remainingText.textContent = `남은 토큰: ${stats.remaining.toLocaleString()}`;
  }
  
  // 업그레이드 버튼 텍스트 업데이트
  const upgradeButton = document.getElementById('upgradeButton');
  if (upgradeButton) {
    if (stats.subscription === 'FREE') {
      upgradeButton.textContent = '구독하기';
    } else {
      upgradeButton.textContent = '구독 관리';
    }
  }
}