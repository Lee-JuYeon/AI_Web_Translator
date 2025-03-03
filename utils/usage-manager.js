// 즉시 실행 함수(IIFE)로 감싸서 전역 스코프 오염 방지
(function() {
  // 초기화 플래그 확인
  if (window.usageManagerInitialized) {
    console.log("[번역 익스텐션] UsageManager 이미 초기화됨");
    return;
  }
  
  // 초기화 플래그 설정
  window.usageManagerInitialized = true;

  // 회원 등급별 월간 토큰 한도
  const SUBSCRIPTION_LIMITS = {
    FREE: 15000,   // 무료 회원: 약 15,000 토큰 (약 30페이지)
    BASIC: 100000, // 기본 회원($5): 약 100,000 토큰 (약 200페이지)
    PREMIUM: -1    // 프리미엄 회원($10): 무제한 (-1)
  };

  // 사용량 관리 객체
  const UsageManager = {
    // 현재 사용자 등급 가져오기
    getCurrentSubscription() {
      return new Promise((resolve) => {
        chrome.storage.sync.get('subscription', (data) => {
          // 기본값은 무료 회원
          const subscription = data.subscription || 'FREE';
          resolve(subscription);
        });
      });
    },
    
    // 현재 월 사용량 가져오기
    getCurrentUsage() {
      return new Promise((resolve) => {
        chrome.storage.sync.get('usage', (data) => {
          // 사용량 데이터가 없으면 초기화
          if (!data.usage || !data.usage.month || data.usage.month !== this.getCurrentMonth()) {
            const newUsage = {
              month: this.getCurrentMonth(),
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
    },
    
    // 현재 월 구하기 (yyyy-mm 형식)
    getCurrentMonth() {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    },
    
    // 토큰 사용량 기록
    async recordUsage(tokens) {
      const usage = await this.getCurrentUsage();
      const newTokensUsed = usage.tokensUsed + tokens;
      
      // 새 사용량으로 업데이트
      const newUsage = {
        ...usage,
        tokensUsed: newTokensUsed
      };
      
      return new Promise((resolve) => {
        chrome.storage.sync.set({ usage: newUsage }, () => {
          resolve(newUsage);
        });
      });
    },
    
    // 번역 가능 여부 확인
    async canTranslate(estimatedTokens) {
      const subscription = await this.getCurrentSubscription();
      const limit = SUBSCRIPTION_LIMITS[subscription];
      
      // 프리미엄 회원은 무제한
      if (limit === -1) {
        return true;
      }
      
      const usage = await this.getCurrentUsage();
      
      // 현재 사용량 + 예상 토큰 <= 한도
      return (usage.tokensUsed + estimatedTokens) <= limit;
    },
    
    // 사용량 통계 가져오기
    async getUsageStats() {
      const subscription = await this.getCurrentSubscription();
      const usage = await this.getCurrentUsage();
      const limit = SUBSCRIPTION_LIMITS[subscription];
      
      return {
        subscription,
        tokensUsed: usage.tokensUsed,
        limit: limit,
        remaining: limit === -1 ? -1 : Math.max(0, limit - usage.tokensUsed),
        percentage: limit === -1 ? 0 : Math.min(100, Math.round((usage.tokensUsed / limit) * 100)),
        lastReset: usage.lastReset
      };
    },
    
    // 토큰 수 추정 (영어 기준)
    estimateTokens(texts) {
      // 영어 기준 1단어 = 약 1.3 토큰
      const tokenRatio = 1.3;
      
      // 모든 텍스트의 단어 수 계산
      const wordCount = texts.reduce((count, text) => {
        // 단어 수 추정 (공백으로 분리)
        return count + text.split(/\s+/).length;
      }, 0);
      
      // 토큰 수 추정 및 10% 버퍼 추가
      return Math.ceil(wordCount * tokenRatio * 1.1);
    },
    
    // 남은 토큰 수 계산
    async getRemainingTokens() {
      const subscription = await this.getCurrentSubscription();
      const limit = SUBSCRIPTION_LIMITS[subscription];
      
      // 프리미엄 회원은 무제한
      if (limit === -1) {
        return -1; // 무제한
      }
      
      const usage = await this.getCurrentUsage();
      return Math.max(0, limit - usage.tokensUsed);
    },
    
    // 구독 등급 설정 (결제 처리 후 호출)
    setSubscription(level) {
      return new Promise((resolve) => {
        chrome.storage.sync.set({ subscription: level }, () => {
          resolve(true);
        });
      });
    },
    
    // 월별 사용량 리셋 체크
    checkAndResetMonthlyUsage() {
      return new Promise((resolve) => {
        this.getCurrentUsage().then(usage => {
          const currentMonth = this.getCurrentMonth();
          
          // 현재 저장된 월과 현재 월이 다르면 리셋
          if (usage.month !== currentMonth) {
            const newUsage = {
              month: currentMonth,
              tokensUsed: 0,
              lastReset: new Date().toISOString()
            };
            
            chrome.storage.sync.set({ usage: newUsage }, () => {
              console.log('[번역 익스텐션] 월간 사용량 리셋 완료');
              resolve(true);
            });
          } else {
            resolve(false);
          }
        });
      });
    },

    // 필요한 경우 SUBSCRIPTION_LIMITS에 접근할 수 있는 메서드
    getLimits() {
      return { ...SUBSCRIPTION_LIMITS };  // 객체 복사본 반환
    }
  };

  
  // 텍스트 번역 전에 토큰 사용량 확인 및 제한
  async function checkUsageBeforeTranslation(texts) {
    // 예상 토큰 수 계산
    const estimatedTokens = UsageManager.estimateTokens(texts);
    
    // 번역 가능 여부 확인
    const canTranslate = await UsageManager.canTranslate(estimatedTokens);
    
    if (!canTranslate) {
      // 번역 한도 초과 알림
      showTranslationLimitExceeded();
      throw new Error("번역 한도를 초과했습니다. 구독 등급을 업그레이드하세요.");
    }
    
    return estimatedTokens;
  }
  
  // 번역 한도 초과 UI 표시
  function showTranslationLimitExceeded() {
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
  
  // 수정된 translateTextsWithGemini 함수 (Worker API 호출 시 사용량 추적 추가)
  async function translateTextsWithGemini(texts) {
    try {
      // 토큰 사용량 확인 및 제한
      const estimatedTokens = await checkUsageBeforeTranslation(texts);
      
      // Worker API에 요청할 데이터 구성
      const requestData = {
        texts: texts,
        targetLang: SETTINGS.targetLang,
        separator: "||TRANSLATE_SEPARATOR||"
      };
  
      // Worker API 호출
      console.log("[번역 익스텐션] Worker API 호출 시작");
      const response = await fetch(SETTINGS.workerEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });
  
      if (!response.ok) {
        let errorMessage = "Worker API 오류";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || response.statusText;
        } catch (e) {
          errorMessage = response.statusText;
        }
        throw new Error(`Worker API 오류: ${errorMessage}`);
      }
  
      // 응답 데이터 파싱
      const data = await response.json();
      console.log("[번역 익스텐션] Worker API 응답 수신 완료");
  
      // 성공 응답 확인
      if (data.success && Array.isArray(data.translations)) {
        // 사용량 기록
        await UsageManager.recordUsage(estimatedTokens);
        
        return data.translations;
      } else {
        throw new Error(data.error || "Worker API에서 유효한 응답을 받지 못했습니다.");
      }
    } catch (error) {
      console.error("[번역 익스텐션] Worker API 호출 오류:", error);
      throw error;
    }
  }
  
  // popup.js에서 사용자 정보 및 사용량 표시 기능
  document.addEventListener('DOMContentLoaded', async function() {
    // 사용량 통계 가져오기
    const stats = await UsageManager.getUsageStats();
    
    // 사용량 UI 업데이트
    updateUsageUI(stats);
    
    // 업그레이드 버튼 이벤트 리스너
    document.getElementById('upgradeButton').addEventListener('click', function() {
      // 결제 페이지로 이동 (실제 구현 필요)
      window.open('https://your-payment-page.com', '_blank');
    });
  });
  
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
  }
  
  // 백그라운드에서 월별 사용량 리셋 처리 (background.js에 추가)
  function setupMonthlyReset() {
    // 매일 자정에 체크
    chrome.alarms.create('checkMonthlyReset', { periodInMinutes: 60 * 24 });
    
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'checkMonthlyReset') {
        const usage = await UsageManager.getCurrentUsage();
        const currentMonth = UsageManager.getCurrentMonth();
        
        // 현재 저장된 월과 현재 월이 다르면 리셋
        if (usage.month !== currentMonth) {
          const newUsage = {
            month: currentMonth,
            tokensUsed: 0,
            lastReset: new Date().toISOString() 
          };
          
          chrome.storage.sync.set({ usage: newUsage });
          console.log('[번역 익스텐션] 월간 사용량 리셋 완료');
        }
      }
    });
  }

  window.UsageManager = UsageManager;

})();

