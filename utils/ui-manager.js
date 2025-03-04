// utils/ui-manager.js
const UIManager = (function() {
    'use strict';
    
    // UI 설정
    const UI_SETTINGS = {
      statusTimeout: 2000,        // 상태 메시지 표시 시간 (ms)
      limitExceededTimeout: 10000 // 한도 초과 알림 표시 시간 (ms)
    };
    
    /**
     * 번역 진행 상태 표시 UI 생성 및 표시
     * @param {string} message - 표시할 메시지
     * @param {boolean} isComplete - 완료 상태 여부
     * @returns {HTMLElement} - 생성된 상태 요소
     */
    function showTranslationStatus(message, isComplete = false) {
      let statusElement = document.getElementById('translation-status-bar');
      
      if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.id = 'translation-status-bar';
        
        // 스타일 설정
        Object.assign(statusElement.style, {
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
          transition: 'all 0.3s ease'
        });
        
        document.body.appendChild(statusElement);
      } else {
        // 완료 상태일 경우 색상 변경
        if (isComplete) {
          statusElement.style.background = '#4CAF50';
        } else {
          statusElement.style.background = '#2196F3';
        }
      }
      
      statusElement.textContent = message;
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
          }
        }, 300);
      }
    }
    
    /**
     * 번역 한도 초과 알림 표시
     * @param {Function} onUpgradeClick - 업그레이드 버튼 클릭 시 콜백
     */
    function showTranslationLimitExceeded(onUpgradeClick) {
      let limitElement = document.getElementById('translation-limit-exceeded');
      
      if (!limitElement) {
        limitElement = document.createElement('div');
        limitElement.id = 'translation-limit-exceeded';
        
        Object.assign(limitElement.style, {
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
        
        // 한도 초과 메시지
        limitElement.innerHTML = `
          <p><strong>번역 한도 초과!</strong></p>
          <p>이번 달 번역 한도를 모두 사용했습니다.</p>
          <p>더 많은 번역을 위해 구독 등급을 업그레이드하세요.</p>
          <button id="upgrade-subscription" style="
            background: white;
            color: #f44336;
            border: none;
            padding: 8px 15px;
            margin-top: 10px;
            border-radius: 3px;
            cursor: pointer;
            font-weight: bold;
          ">업그레이드</button>
        `;
        
        document.body.appendChild(limitElement);
        
        // 업그레이드 버튼 클릭 이벤트
        const upgradeButton = document.getElementById('upgrade-subscription');
        if (upgradeButton) {
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
        
        return limitElement;
      }
      
      return limitElement;
    }
    
    /**
     * 사용량 UI 업데이트 함수 (popup.html에서 사용)
     * @param {Object} stats - 사용량 통계 객체
     */
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
      updatePremiumFeaturesUI(stats.subscription === 'PREMIUM');
    }
    
    /**
     * 프리미엄 기능 UI 업데이트
     * @param {boolean} isPremium - 프리미엄 사용자 여부
     */
    function updatePremiumFeaturesUI(isPremium) {
      const translateImageCheckbox = document.getElementById('translateImage');
      if (translateImageCheckbox) {
        translateImageCheckbox.disabled = !isPremium;
        
        // 프리미엄 기능의 레이블에 disabled 클래스 추가/제거
        const translateImageLabel = translateImageCheckbox.nextElementSibling;
        if (translateImageLabel) {
          if (isPremium) {
            translateImageLabel.classList.remove('disabled-text');
          } else {
            translateImageLabel.classList.add('disabled-text');
          }
        }
      }
      
      // 다른 프리미엄 기능들에 대한 UI 업데이트도 여기에 추가
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
        toastElement = document.createElement('div');
        toastElement.id = 'toast-message';
        
        // 기본 스타일
        Object.assign(toastElement.style, {
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
          transition: 'opacity 0.3s ease'
        });
        
        document.body.appendChild(toastElement);
      }
      
      // 메시지 유형에 따른 색상 설정
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
      
      toastElement.textContent = message;
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
      Object.assign(UI_SETTINGS, newSettings);
    }
    
    /**
     * 현재 설정 가져오기
     * @returns {Object} - 현재 설정
     */
    function getSettings() {
      return {...UI_SETTINGS};
    }
    
    // 이벤트 리스너 설정
    function setupEventListeners() {
      // popup.html에서 사용량 통계 로드 시 UI 업데이트
      window.addEventListener('usage:updated', async (event) => {
        if (document.querySelector('.subscription-info')) {
          // 팝업 페이지인 경우
          try {
            const stats = await window.UsageManager.getUsageStats();
            updateUsageUI(stats);
          } catch (error) {
            console.error("[번역 익스텐션] 사용량 UI 업데이트 오류:", error);
          }
        }
      });
      
      // 한도 초과 이벤트 리스너
      window.addEventListener('translation:limit-exceeded', () => {
        showTranslationLimitExceeded(() => {
          chrome.runtime.sendMessage({ action: "openPopup" });
        });
      });
      
      // 번역 완료 이벤트 리스너
      window.addEventListener('translation:complete', (event) => {
        const detail = event.detail;
        showTranslationStatus(`번역 완료! (총 ${detail.total}개 항목)`, true);
        
        // 일정 시간 후 상태 메시지 숨기기
        setTimeout(() => {
          hideTranslationStatus();
        }, UI_SETTINGS.statusTimeout);
      });
    }
    
    // 초기화
    function init() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupEventListeners);
      } else {
        setupEventListeners();
      }
    }
    
    // 초기화 실행
    init();
    
    // 공개 API
    return {
      showTranslationStatus,
      hideTranslationStatus,
      showTranslationLimitExceeded,
      updateUsageUI,
      updatePremiumFeaturesUI,
      showSettingsSaved,
      showToast,
      updateSettings,
      getSettings
    };
  })();
  
  // 모듈 내보내기
  window.UIManager = UIManager;