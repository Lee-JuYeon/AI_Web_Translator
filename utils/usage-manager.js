// utils/usage-manager.js - 리팩토링 버전
const UsageManager = (function() {
  'use strict';
  
  // 초기화 플래그 확인
  if (window.usageManagerInitialized) {
    console.log("[번역 익스텐션] UsageManager 이미 초기화됨");
    return window.UsageManager;
  }
  
  // 초기화 플래그 설정
  window.usageManagerInitialized = true;

  // 회원 등급별 월간 토큰 한도
  const SUBSCRIPTION_LIMITS = {
    FREE: 15000,   // 무료 회원: 약 15,000 토큰 (약 30페이지)
    BASIC: 100000, // 기본 회원($5): 약 100,000 토큰 (약 200페이지)
    PREMIUM: -1    // 프리미엄 회원($10): 무제한 (-1)
  };

  /**
   * 현재 사용자 등급 가져오기
   * @returns {Promise<string>} - 구독 등급 (FREE, BASIC, PREMIUM)
   */
  async function getCurrentSubscription() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('subscription', (data) => {
        // 기본값은 무료 회원
        const subscription = data.subscription || 'FREE';
        resolve(subscription);
      });
    });
  }
  
  /**
   * 현재 월 구하기 (yyyy-mm 형식)
   * @returns {string} - 현재 월 (yyyy-mm)
   */
  function getCurrentMonth() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  
  /**
   * 현재 월 사용량 가져오기
   * @returns {Promise<Object>} - 사용량 객체
   */
  async function getCurrentUsage() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('usage', (data) => {
        // 사용량 데이터가 없으면 초기화
        if (!data.usage || !data.usage.month || data.usage.month !== getCurrentMonth()) {
          const newUsage = {
            month: getCurrentMonth(),
            tokensUsed: 0,
            lastReset: new Date().toISOString()
          };
          chrome.storage.sync.set({ usage: newUsage });
          resolve(newUsage);
        } else {
          resolve(data.usage);
        }
      });
    });
  }
  
  /**
   * 토큰 사용량 기록
   * @param {number} tokens - 사용한 토큰 수
   * @returns {Promise<Object>} - 업데이트된 사용량 객체
   */
  async function recordUsage(tokens) {
    const usage = await getCurrentUsage();
    const newTokensUsed = usage.tokensUsed + tokens;
    
    // 새 사용량으로 업데이트
    const newUsage = {
      ...usage,
      tokensUsed: newTokensUsed
    };
    
    return new Promise((resolve) => {
      chrome.storage.sync.set({ usage: newUsage }, () => {
        // 이벤트 발생 (사용량 업데이트)
        window.dispatchEvent(new CustomEvent('usage:updated', {
          detail: { usage: newUsage }
        }));
        
        resolve(newUsage);
      });
    });
  }
  
  /**
   * 번역 가능 여부 확인
   * @param {number} estimatedTokens - 예상 토큰 수
   * @returns {Promise<boolean>} - 번역 가능 여부
   */
  async function canTranslate(estimatedTokens) {
    const subscription = await getCurrentSubscription();
    const limit = SUBSCRIPTION_LIMITS[subscription];
    
    // 프리미엄 회원은 무제한
    if (limit === -1) {
      return true;
    }
    
    const usage = await getCurrentUsage();
    
    // 현재 사용량 + 예상 토큰 <= 한도
    return (usage.tokensUsed + estimatedTokens) <= limit;
  }
  
  /**
   * 사용량 통계 가져오기
   * @returns {Promise<Object>} - 사용량 통계 객체
   */
  async function getUsageStats() {
    const subscription = await getCurrentSubscription();
    const usage = await getCurrentUsage();
    const limit = SUBSCRIPTION_LIMITS[subscription];
    
    return {
      subscription,
      tokensUsed: usage.tokensUsed,
      limit: limit,
      remaining: limit === -1 ? -1 : Math.max(0, limit - usage.tokensUsed),
      percentage: limit === -1 ? 0 : Math.min(100, Math.round((usage.tokensUsed / limit) * 100)),
      lastReset: usage.lastReset
    };
  }
  
  /**
   * 토큰 수 추정 (영어 기준)
   * @param {string[]} texts - 번역할 텍스트 배열
   * @returns {number} - 예상 토큰 수
   */
  function estimateTokens(texts) {
    // 영어 기준 1단어 = 약 1.3 토큰
    const tokenRatio = 1.3;
    
    // 모든 텍스트의 단어 수 계산
    const wordCount = texts.reduce((count, text) => {
      // 단어 수 추정 (공백으로 분리)
      return count + text.split(/\s+/).length;
    }, 0);
    
    // 토큰 수 추정 및 10% 버퍼 추가
    return Math.ceil(wordCount * tokenRatio * 1.1);
  }
  
  /**
   * 남은 토큰 수 계산
   * @returns {Promise<number>} - 남은 토큰 수 (-1은 무제한)
   */
  async function getRemainingTokens() {
    const subscription = await getCurrentSubscription();
    const limit = SUBSCRIPTION_LIMITS[subscription];
    
    // 프리미엄 회원은 무제한
    if (limit === -1) {
      return -1; // 무제한
    }
    
    const usage = await getCurrentUsage();
    return Math.max(0, limit - usage.tokensUsed);
  }
  
  /**
   * 구독 등급 설정 (결제 처리 후 호출)
   * @param {string} level - 구독 등급 (FREE, BASIC, PREMIUM)
   * @returns {Promise<boolean>} - 성공 여부
   */
  async function setSubscription(level) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ subscription: level }, () => {
        // 이벤트 발생 (구독 업데이트)
        window.dispatchEvent(new CustomEvent('subscription:updated', {
          detail: { subscription: level }
        }));
        
        resolve(true);
      });
    });
  }
  
  /**
   * 월별 사용량 리셋 체크
   * @returns {Promise<boolean>} - 리셋 여부
   */
  async function checkAndResetMonthlyUsage() {
    const usage = await getCurrentUsage();
    const currentMonth = getCurrentMonth();
    
    // 현재 저장된 월과 현재 월이 다르면 리셋
    if (usage.month !== currentMonth) {
      const newUsage = {
        month: currentMonth,
        tokensUsed: 0,
        lastReset: new Date().toISOString()
      };
      
      return new Promise((resolve) => {
        chrome.storage.sync.set({ usage: newUsage }, () => {
          console.log('[번역 익스텐션] 월간 사용량 리셋 완료');
          
          // 이벤트 발생 (사용량 리셋)
          window.dispatchEvent(new CustomEvent('usage:reset', {
            detail: { usage: newUsage }
          }));
          
          resolve(true);
        });
      });
    }
    
    return false;
  }
  
  /**
   * 모든 구독 한도 가져오기
   * @returns {Object} - 구독 한도 객체
   */
  function getLimits() {
    return { ...SUBSCRIPTION_LIMITS };
  }
  
  // 이벤트 리스너 설정 (필요한 경우)
  function setupEventListeners() {
    // DOMContentLoaded 이벤트에서 사용량 UI 업데이트
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', async () => {
        try {
          // popup.html에서만 실행 (페이지 URL 또는 DOM 구조로 확인)
          if (document.querySelector('.subscription-info')) {
            const stats = await getUsageStats();
            updateUsageUI(stats);
          }
        } catch (error) {
          console.error('[번역 익스텐션] 사용량 UI 업데이트 오류:', error);
        }
      });
    } else {
      // DOMContentLoaded가 이미 발생한 경우
      try {
        // popup.html에서만 실행
        if (document.querySelector('.subscription-info')) {
          getUsageStats().then(stats => {
            updateUsageUI(stats);
          });
        }
      } catch (error) {
        console.error('[번역 익스텐션] 사용량 UI 업데이트 오류:', error);
      }
    }
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
  
  /**
   * 번역 한도 초과 시 알림 표시
   * 참고: DOM 조작은 DOMHandler 모듈로 이동하는 것이 좋음
   * @deprecated 이 함수는 하위 호환성을 위해 유지되며 새 구현에서는 DOMHandler.showTranslationLimitExceeded() 사용 권장
   */
  function showTranslationLimitExceeded() {
    // DOMHandler 모듈이 있는 경우 위임
    if (window.DOMHandler && typeof window.DOMHandler.showTranslationLimitExceeded === 'function') {
      window.DOMHandler.showTranslationLimitExceeded(() => {
        chrome.runtime.sendMessage({ action: "openPopup" });
      });
      return;
    }
    
    // 레거시 구현 (DOMHandler가 없는 경우)
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
      document.getElementById('upgrade-subscription').addEventListener('click', () => {
        // 팝업 열기
        chrome.runtime.sendMessage({ action: "openPopup" });
        // 알림 숨기기
        limitElement.style.display = 'none';
      });
      
      // 10초 후 알림 자동 숨김
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
      }, 10000);
    }
  }

  // 초기화
  setupEventListeners();
  
  // 공개 API
  return {
    getCurrentSubscription,
    getCurrentMonth,
    getCurrentUsage,
    recordUsage,
    canTranslate,
    getUsageStats,
    estimateTokens,
    getRemainingTokens,
    setSubscription,
    checkAndResetMonthlyUsage,
    getLimits,
    updateUsageUI,
    showTranslationLimitExceeded
  };
})();

// 모듈 내보내기
window.UsageManager = UsageManager;