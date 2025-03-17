// ui-manager.js - TonyConfig 활용 리팩토링 버전
const UIManager = (function() {
  'use strict';
  
  // 이미 초기화된 경우 중복 실행 방지
  if (window.uiManagerInitialized) {
    console.log(`[${TonyConfig.APP_CONFIG.appName}] UIManager 이미 초기화됨`);
    return window.UIManager;
  }
  
  // 초기화 플래그 설정
  window.uiManagerInitialized = true;
  
  // UI 설정 (TonyConfig에서 가져옴)
  const UI_SETTINGS = { ...TonyConfig.APP_CONFIG.uiSettings };
  
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
    // 기존 타이머 취소
    if (state.statusTimer) {
      clearTimeout(state.statusTimer);
      state.statusTimer = null;
    }
    
    let statusElement = document.getElementById('translation-status-bar');
    
    if (!statusElement) {
      // 새 상태 요소 생성
      statusElement = createElement('div', {
        id: 'translation-status-bar',
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
      
      document.body.appendChild(statusElement);
      state.activeStatusElement = statusElement;
    } else {
      // 기존 요소 업데이트
      statusElement.textContent = message;
      statusElement.style.background = isComplete ? '#4CAF50' : '#2196F3';
    }
    
    // 자동 숨김 설정
    if (autoHide) {
      state.statusTimer = setTimeout(() => {
        hideTranslationStatus();
      }, UI_SETTINGS.autoHideDelay);
    }
    
    return statusElement;
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
      case (state.translationStats.totalElements > 0):
        const elementsPercent = Math.min(
          100, 
          Math.round((state.translationStats.translatedElements / state.translationStats.totalElements) * 100)
        );
        message = `번역 진행 중: ${state.translationStats.translatedElements}/${state.translationStats.totalElements} 요소 (${elementsPercent}%)`;
        break;
        
      case (state.translationStats.totalTexts > 0):
        const textsPercent = Math.min(
          100, 
          Math.round((state.translationStats.translatedTexts / state.translationStats.totalTexts) * 100)
        );
        message = `번역 진행 중: ${state.translationStats.translatedTexts}/${state.translationStats.totalTexts} 텍스트 (${textsPercent}%)`;
        break;
        
      default:
        message = "번역 진행 중...";
        break;
    }
    
    // 진행 상태 UI 업데이트
    showTranslationStatus(message);
  }
  
  /**
   * 번역 한도 초과 알림 표시
   * @param {Function} onUpgradeClick - 업그레이드 버튼 클릭 시 콜백
   */
  function showTranslationLimitExceeded(onUpgradeClick) {
    let limitElement = document.getElementById('translation-limit-exceeded');
    
    if (!limitElement) {
      // 알림 컨테이너 생성
      limitElement = createElement('div', {
        id: 'translation-limit-exceeded',
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
      
      document.body.appendChild(limitElement);
      
      // 업그레이드 버튼 스타일 설정 및 이벤트 등록
      const upgradeButton = document.getElementById('upgrade-subscription');
      if (upgradeButton) {
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
          limitElement.style.display = 'none';
        });
      }
      
      // 자동 숨김
      setTimeout(() => {
        if (limitElement.parentNode) {
          limitElement.style.opacity = '0';
          limitElement.style.transition = 'opacity 0.5s';
          setTimeout(() => {
            if (limitElement.parentNode) {
              limitElement.parentNode.removeChild(limitElement);
            }
          }, 500);
        }
      }, UI_SETTINGS.limitExceededTimeout);
    }
    
    return limitElement;
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
    
    // 구독 등급 표시
    const subscriptionElement = document.getElementById('subscription-level');
    if (subscriptionElement) {
      let subscriptionName = "";
      
      switch (stats.subscription) {
        case 'BASIC':
          subscriptionName = "기본 ($5/월)";
          break;
        case 'FREE':
        default:
          subscriptionName = "무료";
          break;
      }
      
      subscriptionElement.textContent = subscriptionName;
    }
    
    // 프로그레스 바 업데이트
    const progressBar = document.getElementById('usage-progress');
    if (progressBar) {
      if (stats.subscription === 'BASIC') {
        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = '#4CAF50';
      } else {
        progressBar.style.width = `${stats.percentage}%`;
        
        // 경고 색상 (80% 이상이면 주황색, 95% 이상이면 빨간색)
        switch (true) {
          case (stats.percentage >= 95):
            progressBar.style.backgroundColor = '#f44336';
            break;
          case (stats.percentage >= 80):
            progressBar.style.backgroundColor = '#ff9800';
            break;
          default:
            progressBar.style.backgroundColor = '#2196F3';
            break;
        }
      }
    }
    
    // 사용량 및 남은 양 텍스트 업데이트
    updateUsageTextElements(stats);
    
    // 다음 리셋 날짜 표시
    updateResetDate(stats);
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
        case 'BASIC':
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
        case 'BASIC':
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
      upgradeButton.textContent = stats.subscription === 'FREE' ? '구독하기' : '구독 관리';
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
    let toastElement = document.getElementById('toast-message');
    
    if (!toastElement) {
      // 배경색 결정
      let backgroundColor;
      switch (type) {
        case 'success':
          backgroundColor = '#4CAF50';
          break;
        case 'error':
          backgroundColor = '#f44336';
          break;
        case 'warning':
          backgroundColor = '#ff9800';
          break;
        case 'info':
        default:
          backgroundColor = '#2196F3';
          break;
      }
      
      // 토스트 요소 생성
      toastElement = createElement('div', {
        id: 'toast-message',
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
      
      document.body.appendChild(toastElement);
    } else {
      // 기존 토스트 업데이트
      toastElement.textContent = message;
      
      // 타입에 따른 색상 설정
      switch (type) {
        case 'success':
          toastElement.style.background = '#4CAF50';
          break;
        case 'error':
          toastElement.style.background = '#f44336';
          break;
        case 'warning':
          toastElement.style.background = '#ff9800';
          break;
        case 'info':
        default:
          toastElement.style.background = '#2196F3';
          break;
      }
    }
    
    toastElement.style.opacity = '1';
    
    // 기존 타이머 제거
    if (toastElement.hideTimer) {
      clearTimeout(toastElement.hideTimer);
    }
    
    // 타임아웃 후 숨기기
    toastElement.hideTimer = setTimeout(() => {
      toastElement.style.opacity = '0';
      
      setTimeout(() => {
        if (toastElement.parentNode) {
          toastElement.parentNode.removeChild(toastElement);
        }
      }, 300);
    }, timeout);
    
    return toastElement;
  }
  
  /**
   * 설정 업데이트
   * @param {Object} newSettings - 새 설정 값
   */
  function updateSettings(newSettings) {
    if (!newSettings) return;
    Object.assign(UI_SETTINGS, newSettings);
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
      {
        event: 'usage:updated',
        handler: async () => {
          if (document.querySelector('.subscription-info')) {
            try {
              // UsageManager 모듈이 있는 경우 사용
              if (window.UsageManager && typeof window.UsageManager.getUsageStats === 'function') {
                const stats = await window.UsageManager.getUsageStats();
                updateUsageUI(stats);
              }
            } catch (error) {
              console.error(`[${TonyConfig.APP_CONFIG.appName}] 사용량 UI 업데이트 오류:`, error);
            }
          }
        }
      },
      {
        event: 'usage:limit-exceeded',
        handler: () => {
          showTranslationLimitExceeded(() => {
            // 확장 프로그램 컨텍스트가 유효한 경우 팝업 열기
            if (TonyConfig.isExtensionContextValid()) {
              chrome.runtime.sendMessage({ action: "openPopup" });
            }
          });
        }
      },
      {
        event: 'translation:complete',
        handler: (event) => {
          const detail = event.detail;
          if (detail && detail.summary) {
            showTranslationSummary(detail.summary);
          } else {
            showTranslationStatus("번역 완료!", true, true);
          }
        }
      },
      {
        event: 'translation:progress',
        handler: (event) => {
          const detail = event.detail;
          if (detail && detail.stats) {
            updateTranslationProgress(detail.stats);
          }
        }
      },
      {
        event: 'dom:text-replaced',
        handler: (event) => {
          const detail = event.detail;
          if (detail && detail.count > 0) {
            // 번역 통계 업데이트
            state.translationStats.translatedTexts += detail.count;
            updateTranslationProgress();
          }
        }
      }
    ];
    
    // 이벤트 리스너 등록
    eventListeners.forEach(listener => {
      window.addEventListener(
        listener.event, 
        TonyConfig.createSafeEventListener(listener.event, listener.handler)
      );
    });
  }
  
  // 초기화 실행
  setupEventListeners();
  
  // 공개 API
  return {
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
})();

// 모듈 내보내기
window.UIManager = UIManager;