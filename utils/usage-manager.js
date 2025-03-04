// utils/usage-manager.js - UI 로직 분리 버전
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
    const isWithinLimit = (usage.tokensUsed + estimatedTokens) <= limit;
    
    // 한도 초과 시 이벤트 발생
    if (!isWithinLimit) {
      window.dispatchEvent(new CustomEvent('usage:limit-exceeded', {
        detail: { 
          required: estimatedTokens,
          available: Math.max(0, limit - usage.tokensUsed)
        }
      }));
    }
    
    return isWithinLimit;
  }
  
  /**
   * 사용량 통계 가져오기
   * @returns {Promise<Object>} - 사용량 통계 객체
   */
  async function getUsageStats() {
    const subscription = await getCurrentSubscription();
    const usage = await getCurrentUsage();
    const limit = SUBSCRIPTION_LIMITS[subscription];
    
    const stats = {
      subscription,
      tokensUsed: usage.tokensUsed,
      limit: limit,
      remaining: limit === -1 ? -1 : Math.max(0, limit - usage.tokensUsed),
      percentage: limit === -1 ? 0 : Math.min(100, Math.round((usage.tokensUsed / limit) * 100)),
      lastReset: usage.lastReset
    };
    
    // 이벤트 발생 (사용량 통계 준비됨)
    window.dispatchEvent(new CustomEvent('usage:stats-ready', {
      detail: { stats }
    }));
    
    return stats;
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
  
  /**
   * 구독 등급을 사람이 읽기 쉬운 형태로 변환
   * @param {string} subscription - 구독 등급 코드
   * @returns {string} - 표시 이름
   */
  function getSubscriptionDisplayName(subscription) {
    switch (subscription) {
      case 'BASIC': return "기본 ($5/월)";
      case 'PREMIUM': return "프리미엄 ($10/월)";
      case 'FREE':
      default: return "무료";
    }
  }
  
  /**
   * 사용량을 로컬에 캐싱 (성능 최적화)
   */
  async function cacheLocalUsage() {
    try {
      const stats = await getUsageStats();
      
      // 로컬 스토리지에 캐싱 (옵션)
      if (window.localStorage) {
        localStorage.setItem('usageStats', JSON.stringify({
          stats,
          timestamp: Date.now()
        }));
      }
    } catch (error) {
      console.error("[번역 익스텐션] 사용량 캐싱 오류:", error);
    }
  }
  
  // 초기화 - 사용량 캐싱 (시작 시 1회)
  cacheLocalUsage();
  
  // 이벤트 리스너 설정
  window.addEventListener('usage:updated', () => cacheLocalUsage());
  window.addEventListener('subscription:updated', () => cacheLocalUsage());
  
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
    getSubscriptionDisplayName
  };
})();

// 모듈 내보내기
window.UsageManager = UsageManager;