// popup.js - 리팩토링 버전
document.addEventListener('DOMContentLoaded', async function() {
  try {
    // 언어 목록 로드 및 UI 초기화
    await initializePopup();
  } catch (error) {
    console.error("팝업 초기화 오류:", error);
    showErrorMessage("팝업 초기화 중 오류가 발생했습니다.");
  }
});

/**
 * 팝업 초기화 함수
 */
async function initializePopup() {
  // 언어 목록 로드
  await loadLanguages();
  
  // 저장된 설정 로드
  await loadSettings();
  
  // 사용량 통계 가져오기
  const stats = await getUsageStats();
  
  // 사용량 UI 업데이트
  updateUsageUI(stats);
  
  // 이벤트 리스너 설정
  setupEventListeners();
}

/**
 * 언어 목록 로드 및 UI 업데이트
 */
async function loadLanguages() {
  try {
    const response = await fetch('../languages.json');
    const data = await response.json();
    
    if (!data || !data.languages || !Array.isArray(data.languages)) {
      throw new Error("언어 데이터 형식이 올바르지 않습니다.");
    }
    
    const languages = data.languages;
    
    // 언어 선택 드롭다운 채우기
    const targetLangSelect = document.getElementById('targetLang');
    if (!targetLangSelect) return;
    
    // 기존 옵션 제거
    targetLangSelect.innerHTML = '';
    
    // 언어 옵션 추가
    languages.forEach(lang => {
      const option = document.createElement('option');
      option.value = lang.code;
      option.textContent = `${lang.native} (${lang.name})`;
      targetLangSelect.appendChild(option);
    });
    
    // 시스템 언어로 초기 설정 (기본값은 한국어)
    const systemLang = navigator.language.split('-')[0];
    const hasSystemLang = Array.from(targetLangSelect.options).some(option => option.value === systemLang);
    
    if (hasSystemLang) {
      targetLangSelect.value = systemLang;
    } else {
      targetLangSelect.value = 'ko'; // 기본값
    }
    
    return languages;
  } catch (error) {
    console.error("언어 목록 로드 오류:", error);
    
    // 오류 시 기본 언어 옵션 추가
    const targetLangSelect = document.getElementById('targetLang');
    if (targetLangSelect) {
      targetLangSelect.innerHTML = '<option value="ko">한국어 (Korean)</option>';
    }
    
    return [{ code: 'ko', name: 'Korean', native: '한국어' }];
  }
}

/**
 * 저장된 설정 로드
 */
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('settings', (data) => {
      const settings = data.settings || { targetLang: navigator.language.split('-')[0], autoTranslate: false };
      
      // 번역 언어 설정
      const targetLangSelect = document.getElementById('targetLang');
      if (targetLangSelect && settings.targetLang) {
        // 해당 언어 옵션이 존재하는지 확인
        const optionExists = Array.from(targetLangSelect.options).some(
          option => option.value === settings.targetLang
        );
        
        if (optionExists) {
          targetLangSelect.value = settings.targetLang;
        }
      }
      
      // 자동 번역 설정
      const autoTranslateCheckbox = document.getElementById('autoTranslate');
      if (autoTranslateCheckbox && settings.autoTranslate !== undefined) {
        autoTranslateCheckbox.checked = settings.autoTranslate;
      }
      
      resolve(settings);
    });
  });
}

/**
 * 설정 저장 함수
 */
function saveSettings() {
  const settings = {
    targetLang: document.getElementById('targetLang').value,
    autoTranslate: document.getElementById('autoTranslate').checked
  };
  
  chrome.storage.sync.set({ settings }, () => {
    // 저장된 설정을 활성 탭에 전달
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          action: "updateSettings", 
          settings: settings 
        }).catch(error => {
          console.warn("탭에 메시지 전송 실패:", error);
        });
      }
    });
  });
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
  // 현재 페이지 번역 버튼
  const translateButton = document.getElementById('translateButton');
  if (translateButton) {
    translateButton.addEventListener('click', translateCurrentPage);
  }
  
  // 설정 변경 이벤트
  const settingControls = ['targetLang', 'autoTranslate'];
  settingControls.forEach(controlId => {
    const control = document.getElementById(controlId);
    if (control) {
      control.addEventListener('change', saveSettings);
    }
  });
  
  // 업그레이드 버튼
  const upgradeButton = document.getElementById('upgradeButton');
  if (upgradeButton) {
    upgradeButton.addEventListener('click', openSubscriptionPage);
  }
  
  // 링크 이벤트
  const links = {
    'privacyLink': 'https://tony-translator.com/privacy',
    'helpLink': 'https://tony-translator.com/help'
  };
  
  Object.entries(links).forEach(([id, url]) => {
    const link = document.getElementById(id);
    if (link) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url });
      });
    }
  });
}

/**
 * 현재 페이지 번역
 */
function translateCurrentPage() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "translatePage" })
        .catch(error => {
          console.warn("번역 요청 전송 실패:", error);
          // 콘텐츠 스크립트가 로드되지 않은 경우 처리
          injectContentScripts(tabs[0].id);
        });
      
      window.close(); // 팝업 닫기
    }
  });
}

/**
 * 콘텐츠 스크립트 로드
 */
function injectContentScripts(tabId) {
  chrome.runtime.sendMessage({ 
    action: "injectContentScripts", 
    tabId: tabId 
  }, (response) => {
    console.log("콘텐츠 스크립트 로드 응답:", response);
  });
}

/**
 * 구독 페이지 열기
 */
function openSubscriptionPage() {
  chrome.tabs.create({ url: 'https://tony-translator.com/subscription' });
}

/**
 * 사용량 통계 가져오기
 */
async function getUsageStats() {
  try {
    // 모듈이 로드되었는지 확인
    if (window.UsageManager && typeof window.UsageManager.getUsageStats === 'function') {
      return await window.UsageManager.getUsageStats();
    }
    
    // 모듈이 없으면 백그라운드 스크립트에 요청
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "getUsageStats" }, (response) => {
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
            percentage,
            lastReset: usage.lastReset
          });
        } else {
          resolve(getDefaultStats());
        }
      });
    });
  } catch (error) {
    console.error("사용량 통계 가져오기 오류:", error);
    return getDefaultStats();
  }
}

/**
 * 기본 사용량 통계
 */
function getDefaultStats() {
  return {
    subscription: 'FREE',
    tokensUsed: 0,
    limit: 15000,
    remaining: 15000,
    percentage: 0,
    lastReset: new Date().toISOString()
  };
}

/**
 * 구독 등급별 토큰 한도
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
 * 사용량 UI 업데이트
 */
function updateUsageUI(stats) {
  // 구독 등급 표시
  const subscriptionElement = document.getElementById('subscription-level');
  if (subscriptionElement) {
    switch (stats.subscription) {
      case 'BASIC':
        subscriptionElement.textContent = "기본 ($5/월)";
        break;
      case 'FREE':
      default:
        subscriptionElement.textContent = "무료";
    }
  }
  
  // 프로그레스 바 업데이트
  const progressBar = document.getElementById('usage-progress');
  if (progressBar) {
    progressBar.style.width = `${stats.percentage}%`;
    
    // 사용량에 따른 색상 변경
    switch (true) {
      case (stats.percentage >= 95):
        progressBar.style.backgroundColor = '#f44336'; // 빨강
        break;
      case (stats.percentage >= 80):
        progressBar.style.backgroundColor = '#ff9800'; // 주황
        break;
      default:
        progressBar.style.backgroundColor = '#2196F3'; // 파랑
    }
  }
  
  // 사용량 텍스트 업데이트
  const usageText = document.getElementById('usage-text');
  if (usageText) {
    usageText.textContent = `${stats.tokensUsed.toLocaleString()} / ${stats.limit.toLocaleString()} 토큰 사용`;
  }
  
  // 남은 토큰 텍스트 업데이트
  const remainingText = document.getElementById('remaining-text');
  if (remainingText) {
    remainingText.textContent = `남은 토큰: ${stats.remaining.toLocaleString()}`;
  }
  
  // 업그레이드 버튼 텍스트 업데이트
  const upgradeButton = document.getElementById('upgradeButton');
  if (upgradeButton) {
    upgradeButton.textContent = stats.subscription === 'FREE' ? '구독하기' : '구독 관리';
  }
}

/**
 * 오류 메시지 표시
 */
function showErrorMessage(message) {
  const container = document.querySelector('.container');
  if (!container) return;
  
  const errorElement = document.createElement('div');
  errorElement.className = 'error-message';
  errorElement.textContent = message;
  errorElement.style.color = '#f44336';
  errorElement.style.padding = '10px';
  errorElement.style.marginTop = '10px';
  errorElement.style.border = '1px solid #f44336';
  errorElement.style.borderRadius = '4px';
  
  container.appendChild(errorElement);
}