// ui-manager.js - ES 모듈 방식으로 리팩토링
import { APP_CONFIG, safeDispatchEvent, createSafeEventListener } from '../config.js';

// 내부 상태 관리
let uiManagerInitialized = false;

// UI 설정 (APP_CONFIG에서 가져옴)
const UI_SETTINGS = { ...APP_CONFIG.uiSettings };

// 내부 상태 관리
const state = {
  activeStatusElement: null,
  statusTimer: null,
  translationStats: {
    totalElements: 0,
    translatedElements: 0,
    totalTexts: 0,
    translatedTexts: 0,
    lastUpdate: Date.now()
  }
};

/**
 * 요소 생성 헬퍼 함수
 * @param {string} tagName - 태그 이름
 * @param {Object} props - 요소 속성
 * @param {Object} styles - 요소 스타일
 * @returns {HTMLElement} - 생성된 요소
 */
function createElement(tagName, props = {}, styles = {}) {
  const element = document.createElement(tagName);
  
  // 속성 설정
  Object.entries(props).forEach(([key, value]) => {
    switch (key) {
      case 'textContent':
        element.textContent = value;
        break;
      case 'innerHTML':
        element.innerHTML = value;
        break;
      case 'className':
        element.className = value;
        break;
      case 'id':
        element.id = value;
        break;
      default:
        element.setAttribute(key, value);
        break;
    }
  });
  
  // 스타일 설정
  Object.assign(element.style, styles);
  
  return element;
}

/**
 * 번역 진행 상태 표시 UI 생성 및 표시
 * @param {string} message - 표시할 메시지
 * @param {boolean} isComplete - 완료 상태 여부
 * @param {boolean} autoHide - 자동 숨김 여부
 * @returns {HTMLElement} - 생성된 상태 요소
 */
function showTranslationStatus(message, isComplete = false, autoHide = false) {
  // 이미 초기화된 경우 중복 실행 방지
  if (!uiManagerInitialized) {
    console.log(`[${APP_CONFIG.appName}] UIManager 초기화 중`);
    uiManagerInitialized = true;
  }

  // 기존 타이머 취소
  if (state.statusTimer) {
    clearTimeout(state.statusTimer);
    state.statusTimer = null;
  }
  
  // 상태 요소 ID
  const statusElementId = 'translation-status-bar';
  let statusElement = document.getElementById(statusElementId);
  
  // 상태 요소 생성 또는 업데이트
  if (!statusElement) {
    statusElement = createStatusElement(statusElementId, message, isComplete);
    document.body.appendChild(statusElement);
    state.activeStatusElement = statusElement;
  } else {
    // 기존 요소 업데이트
    updateStatusElement(statusElement, message, isComplete);
  }
  
  // 자동 숨김 설정
  if (autoHide) {
    setupAutoHide(statusElement);
  }
  
  return statusElement;
}

/**
 * 상태 요소 생성
 * @param {string} elementId - 요소 ID
 * @param {string} message - 표시할 메시지
 * @param {boolean} isComplete - 완료 상태 여부
 * @returns {HTMLElement} - 생성된 상태 요소
 */
function createStatusElement(elementId, message, isComplete) {
  return createElement('div', {
    id: elementId,
    textContent: message
  }, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    padding: '10px 15px',
    background: isComplete ? '#4CAF50' : '#2196F3',
    color: 'white',
    borderRadius: '5px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    zIndex: '9999',
    fontSize: '14px',
    fontFamily: 'Arial, sans-serif',
    transition: 'all 0.3s ease',
    maxWidth: '300px'
  });
}

/**
 * 상태 요소 업데이트
 * @param {HTMLElement} element - 상태 요소
 * @param {string} message - 표시할 메시지
 * @param {boolean} isComplete - 완료 상태 여부
 */
function updateStatusElement(element, message, isComplete) {
  element.textContent = message;
  element.style.background = isComplete ? '#4CAF50' : '#2196F3';
}

/**
 * 자동 숨김 설정
 * @param {HTMLElement} element - 상태 요소
 */
function setupAutoHide(element) {
  state.statusTimer = setTimeout(() => {
    hideTranslationStatus();
  }, UI_SETTINGS.autoHideDelay);
}

/**
 * 번역 상태 UI 숨기기
 */
function hideTranslationStatus() {
  const statusElement = document.getElementById('translation-status-bar');
  if (statusElement) {
    // 애니메이션 후 제거
    statusElement.style.opacity = '0';
    setTimeout(() => {
      if (statusElement.parentNode) {
        statusElement.parentNode.removeChild(statusElement);
        state.activeStatusElement = null;
      }
    }, 300);
  }
  
  if (state.statusTimer) {
    clearTimeout(state.statusTimer);
    state.statusTimer = null;
  }
}

/**
 * 번역 진행 상태 UI 업데이트
 * @param {Object} stats - 진행 상태 통계
 */
function updateTranslationProgress(stats) {
  // 상태 통계 업데이트
  if (stats) {
    Object.assign(state.translationStats, stats);
  }
  
  // 마지막 업데이트 시간 검사 (너무 빈번한 업데이트 방지)
  const now = Date.now();
  if (now - state.translationStats.lastUpdate < UI_SETTINGS.progressUpdateInterval) {
    return;
  }
  
  state.translationStats.lastUpdate = now;
  
  // 진행 상태 메시지 생성
  let message = "";
  
  switch (true) {
    // 요소 기준 진행 상태
    case (state.translationStats.totalElements > 0):
      const elementsPercent = calculatePercentage(
        state.translationStats.translatedElements, 
        state.translationStats.totalElements
      );
      message = `번역 진행 중: ${state.translationStats.translatedElements}/${state.translationStats.totalElements} 요소 (${elementsPercent}%)`;
      break;
      
    // 텍스트 기준 진행 상태
    case (state.translationStats.totalTexts > 0):
      const textsPercent = calculatePercentage(
        state.translationStats.translatedTexts, 
        state.translationStats.totalTexts
      );
      message = `번역 진행 중: ${state.translationStats.translatedTexts}/${state.translationStats.totalTexts} 텍스트 (${textsPercent}%)`;
      break;
      
    // 기본 메시지
    default:
      message = "번역 진행 중...";
      break;
  }
  
  // 진행 상태 UI 업데이트
  showTranslationStatus(message);
}

/**
 * 백분율 계산 (0-100)
 * @param {number} value - 현재 값
 * @param {number} total - 전체 값
 * @returns {number} - 백분율
 */
function calculatePercentage(value, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

/**
 * 번역 한도 초과 알림 표시
 * @param {Function} onUpgradeClick - 업그레이드 버튼 클릭 시 콜백
 */
function showTranslationLimitExceeded(onUpgradeClick) {
  const limitElementId = 'translation-limit-exceeded';
  let limitElement = document.getElementById(limitElementId);
  
  if (!limitElement) {
    // 알림 컨테이너 생성
    limitElement = createLimitExceededElement(limitElementId);
    document.body.appendChild(limitElement);
    
    // 업그레이드 버튼 설정
    setupUpgradeButton(limitElement, onUpgradeClick);
    
    // 자동 숨김
    setTimeout(() => {
      fadeLimitElement(limitElement);
    }, UI_SETTINGS.limitExceededTimeout);
  }
  
  return limitElement;
}

/**
 * 한도 초과 요소 생성
 * @param {string} elementId - 요소 ID
 * @returns {HTMLElement} - 생성된 요소
 */
function createLimitExceededElement(elementId) {
  return createElement('div', {
    id: elementId,
    innerHTML: `
      <p><strong>번역 한도 초과!</strong></p>
      <p>이번 달 번역 한도를 모두 사용했습니다.</p>
      <p>더 많은 번역을 위해 구독 등급을 업그레이드하세요.</p>
      <button id="upgrade-subscription">업그레이드</button>
    `
  }, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    padding: '15px 20px',
    background: '#f44336',
    color: 'white',
    borderRadius: '5px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
    zIndex: '9999',
    fontSize: '14px',
    fontFamily: 'Arial, sans-serif',
    textAlign: 'center',
    maxWidth: '300px'
  });
}

/**
 * 업그레이드 버튼 설정
 * @param {HTMLElement} container - 컨테이너 요소
 * @param {Function} onUpgradeClick - 클릭 콜백
 */
function setupUpgradeButton(container, onUpgradeClick) {
  const upgradeButton = container.querySelector('#upgrade-subscription');
  if (upgradeButton) {
    // 버튼 스타일 설정
    Object.assign(upgradeButton.style, {
      background: 'white',
      color: '#f44336',
      border: 'none',
      padding: '8px 15px',
      marginTop: '10px',
      borderRadius: '3px',
      cursor: 'pointer',
      fontWeight: 'bold'
    });
    
    // 버튼 클릭 이벤트
    upgradeButton.addEventListener('click', () => {
      // 콜백 실행
      if (typeof onUpgradeClick === 'function') {
        onUpgradeClick();
      }
      
      // 알림 숨기기
      container.style.display = 'none';
    });
  }
}

/**
 * 한도 초과 요소 페이드 아웃
 * @param {HTMLElement} element - 한도 초과 요소
 */
function fadeLimitElement(element) {
  if (element.parentNode) {
    element.style.opacity = '0';
    element.style.transition = 'opacity 0.5s';
    setTimeout(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }, 500);
  }
}

/**
 * 번역 완료 요약 표시
 * @param {Object} summary - 번역 요약 데이터
 */
function showTranslationSummary(summary) {
  const { totalElements, translatedElements, totalTexts, translatedTexts, elapsedTime } = summary;
  
  // 요약 메시지 생성
  let messageParts = ["번역 완료!"];
  
  if (totalElements && translatedElements) {
    messageParts.push(`${translatedElements}/${totalElements} 요소`);
  }
  
  if (totalTexts && translatedTexts) {
    messageParts.push(`${translatedTexts}/${totalTexts} 텍스트`);
  }
  
  if (elapsedTime) {
    messageParts.push(`(${(elapsedTime / 1000).toFixed(1)}초)`);
  }
  
  // 요약 표시
  showTranslationStatus(messageParts.join(' '), true, true);
  
  // 상태 통계 초기화
  resetTranslationStats();
}

/**
 * 번역 통계 초기화
 */
function resetTranslationStats() {
  state.translationStats = {
    totalElements: 0,
    translatedElements: 0,
    totalTexts: 0,
    translatedTexts: 0,
    lastUpdate: Date.now()
  };
}

/**
 * 사용량 UI 업데이트 함수 (popup.html에서 사용)
 * @param {Object} stats - 사용량 통계 객체
 */
function updateUsageUI(stats) {
  if (!stats) return;
  
  // 구독 등급, 프로그래스 바, 사용량 텍스트 업데이트
  updateSubscriptionBadge(stats);
  updateProgressBar(stats);
  updateUsageTextElements(stats);
  updateResetDate(stats);
}

/**
 * 구독 등급 배지 업데이트
 * @param {Object} stats - 사용량 통계 객체
 */
function updateSubscriptionBadge(stats) {
  const subscriptionElement = document.getElementById('subscription-level');
  if (subscriptionElement) {
    switch (stats.subscription) {
      case 'BASIC':
        subscriptionElement.textContent = "기본 ($5/월)";
        break;
      case 'PRO':
        subscriptionElement.textContent = "프로 ($10/월)";
        break;
      case 'UNLIMITED':
        subscriptionElement.textContent = "무제한";
        break;
      case 'FREE':
      default:
        subscriptionElement.textContent = "무료";
        break;
    }
  }
}

/**
 * 프로그레스 바 업데이트
 * @param {Object} stats - 사용량 통계 객체
 */
function updateProgressBar(stats) {
  const progressBar = document.getElementById('usage-progress');
  if (progressBar) {
    // 무제한 또는 유료 구독 처리
    switch (stats.subscription) {
      case 'UNLIMITED':
        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = '#4CAF50'; // 녹색
        break;
        
      default:
        progressBar.style.width = `${stats.percentage}%`;
        
        // 사용량 기준 색상 변경
        switch (true) {
          case (stats.percentage >= 95):
            progressBar.style.backgroundColor = '#f44336'; // 빨간색
            break;
          case (stats.percentage >= 80):
            progressBar.style.backgroundColor = '#ff9800'; // 주황색
            break;
          default:
            progressBar.style.backgroundColor = '#2196F3'; // 파란색
            break;
        }
        break;
    }
  }
}

/**
 * 사용량 텍스트 요소들 업데이트
 * @param {Object} stats - 사용량 통계 객체
 */
function updateUsageTextElements(stats) {
  // 사용량 텍스트 업데이트
  const usageText = document.getElementById('usage-text');
  if (usageText) {
    switch (stats.subscription) {
      case 'UNLIMITED':
        usageText.textContent = '무제한 사용 가능';
        break;
      default:
        usageText.textContent = `${stats.tokensUsed.toLocaleString()} / ${stats.limit.toLocaleString()} 토큰 사용`;
        break;
    }
  }
  
  // 남은 양 업데이트
  const remainingText = document.getElementById('remaining-text');
  if (remainingText) {
    switch (stats.subscription) {
      case 'UNLIMITED':
        remainingText.textContent = '무제한';
        break;
      default:
        remainingText.textContent = `남은 토큰: ${stats.remaining.toLocaleString()}`;
        break;
    }
  }
  
  // 업그레이드 버튼 텍스트 업데이트
  const upgradeButton = document.getElementById('upgradeButton');
  if (upgradeButton) {
    switch (stats.subscription) {
      case 'FREE':
        upgradeButton.textContent = '구독하기';
        break;
      default:
        upgradeButton.textContent = '구독 관리';
        break;
    }
  }
}

/**
 * 리셋 날짜 업데이트
 * @param {Object} stats - 사용량 통계 객체
 */
function updateResetDate(stats) {
  const resetText = document.getElementById('reset-date');
  if (resetText && stats.lastReset) {
    const resetDate = new Date(stats.lastReset);
    // 다음 달의 리셋 날짜 계산
    resetDate.setMonth(resetDate.getMonth() + 1);
    
    const formattedDate = `${resetDate.getFullYear()}년 ${resetDate.getMonth() + 1}월 ${resetDate.getDate()}일`;
    resetText.textContent = `다음 리셋: ${formattedDate}`;
  }
}

/**
 * 설정 저장 완료 표시
 * @param {HTMLElement} button - 저장 버튼 요소
 * @param {string} originalText - 원래 버튼 텍스트
 * @param {string} completionText - 완료 시 표시할 텍스트
 */
function showSettingsSaved(button, originalText = "설정 저장", completionText = "저장됨!") {
  if (!button) return;
  
  const btnText = button.textContent;
  button.textContent = completionText;
  
  setTimeout(() => {
    button.textContent = originalText || btnText;
  }, 1500);
}

/**
 * 메시지 토스트 표시
 * @param {string} message - 표시할 메시지
 * @param {string} type - 메시지 유형 ('success', 'error', 'info', 'warning')
 * @param {number} timeout - 표시 시간(ms)
 */
function showToast(message, type = 'info', timeout = 3000) {
  const toastElementId = 'toast-message';
  let toastElement = document.getElementById(toastElementId);
  
  if (!toastElement) {
    // 토스트 생성
    toastElement = createToastElement(toastElementId, message, type);
    document.body.appendChild(toastElement);
  } else {
    // 기존 토스트 업데이트
    updateToastElement(toastElement, message, type);
  }
  
  // 표시 및 타이머 설정
  showAndHideToast(toastElement, timeout);
  
  return toastElement;
}

/**
 * 토스트 요소 생성
 * @param {string} id - 요소 ID
 * @param {string} message - 메시지
 * @param {string} type - 메시지 유형
 * @returns {HTMLElement} - 생성된 토스트 요소
 */
function createToastElement(id, message, type) {
  const backgroundColor = getToastBackgroundColor(type);
  
  return createElement('div', {
    id,
    textContent: message
  }, {
    position: 'fixed',
    bottom: '10px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 20px',
    borderRadius: '4px',
    color: 'white',
    fontSize: '14px',
    fontFamily: 'Arial, sans-serif',
    boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
    zIndex: '10000',
    transition: 'opacity 0.3s ease',
    background: backgroundColor
  });
}

/**
 * 토스트 요소 업데이트
 * @param {HTMLElement} element - 토스트 요소
 * @param {string} message - 메시지
 * @param {string} type - 메시지 유형
 */
function updateToastElement(element, message, type) {
  element.textContent = message;
  element.style.background = getToastBackgroundColor(type);
}

/**
 * 토스트 표시 및 숨김 설정
 * @param {HTMLElement} element - 토스트 요소
 * @param {number} timeout - 표시 시간
 */
function showAndHideToast(element, timeout) {
  element.style.opacity = '1';
  
  // 기존 타이머 제거
  if (element.hideTimer) {
    clearTimeout(element.hideTimer);
  }
  
  // 타임아웃 후 숨기기
  element.hideTimer = setTimeout(() => {
    element.style.opacity = '0';
    
    setTimeout(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }, 300);
  }, timeout);
}

/**
 * 토스트 유형별 배경색 가져오기
 * @param {string} type - 메시지 유형
 * @returns {string} - 배경색 코드
 */
function getToastBackgroundColor(type) {
  switch (type) {
    case 'success':
      return '#4CAF50';
    case 'error':
      return '#f44336';
    case 'warning':
      return '#ff9800';
    case 'info':
    default:
      return '#2196F3';
  }
}

/**
 * 설정 업데이트
 * @param {Object} newSettings - 새 설정 값
 */
function updateSettings(newSettings) {
  if (!newSettings) return;
  
  // 변경 사항 저장
  const changedSettings = {};
  
  // 변경된 설정 확인 및 적용
  Object.entries(newSettings).forEach(([key, value]) => {
    if (UI_SETTINGS[key] !== value) {
      UI_SETTINGS[key] = value;
      changedSettings[key] = value;
    }
  });
  
  // 변경 사항이 있는 경우 로그 출력
  if (Object.keys(changedSettings).length > 0) {
    console.log(`[${APP_CONFIG.appName}] UI 설정 업데이트:`, changedSettings);
  }
}

/**
 * 현재 설정 가져오기
 * @returns {Object} - 현재 설정
 */
function getSettings() {
  return {...UI_SETTINGS};
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
  // DOM 로드 시에만 이벤트 리스너 설정
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEventListeners);
  } else {
    initEventListeners();
  }
}

/**
 * 이벤트 리스너 초기화
 */
function initEventListeners() {
  // 이벤트 리스너 설정
  const eventListeners = [
    // 사용량 업데이트 이벤트
    {
      event: 'usage:updated',
      handler: async (event, detail) => {
        if (document.querySelector('.subscription-info')) {
          try {
            // UsageManager 모듈이 있는 경우 사용
            if (window.UsageManager && typeof window.UsageManager.getUsageStats === 'function') {
              const stats = await window.UsageManager.getUsageStats();
              updateUsageUI(stats);
            }
          } catch (error) {
            console.error(`[${APP_CONFIG.appName}] 사용량 UI 업데이트 오류:`, error);
          }
        }
      }
    },
    
    // 한도 초과 이벤트
    {
      event: 'usage:limit-exceeded',
      handler: (event, detail) => {
        showTranslationLimitExceeded(() => {
          // 확장 프로그램 컨텍스트가 유효한 경우 팝업 열기
          if (chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: "openPopup" });
          }
        });
      }
    },
    
    // 번역 완료 이벤트
    {
      event: 'translation:complete',
      handler: (event, detail) => {
        if (detail && detail.summary) {
          showTranslationSummary(detail.summary);
        } else {
          showTranslationStatus("번역 완료!", true, true);
        }
      }
    },
    
    // 번역 진행 상태 이벤트
    {
      event: 'translation:progress',
      handler: (event, detail) => {
        if (detail && detail.stats) {
          updateTranslationProgress(detail.stats);
        }
      }
    },
    
    // 텍스트 교체 이벤트
    {
      event: 'dom:text-replaced',
      handler: (event, detail) => {
        if (detail && detail.count > 0) {
          // 번역 통계 업데이트
          state.translationStats.translatedTexts += detail.count;
          updateTranslationProgress();
        }
      }
    }
  ];
  
  // 이벤트 리스너 등록 (안전한 리스너 사용)
  eventListeners.forEach(listener => {
    window.addEventListener(
      listener.event, 
      createSafeEventListener(listener.event, listener.handler)
    );
  });
}

// 초기화 실행
setupEventListeners();

// 모듈 내보내기
export {
  showTranslationStatus,
  hideTranslationStatus,
  showTranslationLimitExceeded,
  updateTranslationProgress,
  showTranslationSummary,
  updateUsageUI,
  showSettingsSaved,
  showToast,
  updateSettings,
  getSettings
};