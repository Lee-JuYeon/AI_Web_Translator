// 전역 상수 객체를 정의하는 즉시 실행 함수
(function(window) {
    'use strict';
    
    // 상수 객체
    window.Constants = {
      SUBSCRIPTION_LEVELS: {
        FREE: 'FREE',
        BASIC: 'BASIC',
        PREMIUM: 'PREMIUM'
      },
      
      SUBSCRIPTION_LIMITS: {
        FREE: 15000,   // 무료 회원: 약 15,000 토큰 (약 30페이지)
        BASIC: 100000, // 기본 회원($5): 약 100,000 토큰 (약 200페이지)
        PREMIUM: -1    // 프리미엄 회원($10): 무제한 (-1)
      },
      
      TRANSLATION_SETTINGS: {
        workerEndpoint: 'https://translate-worker.redofyear2.workers.dev',
        defaultTargetLang: 'ko',  // 대상 언어 (한국어)
        minTextLength: 2,         // 번역할 최소 텍스트 길이
        batchSize: 40,            // 최적 배치 크기
        maxConcurrentBatches: 3,  // 최대 동시 배치 처리 수
        scrollThreshold: 200      // 스크롤 감지 임계값 (픽셀)
      },
      
      CACHE_SETTINGS: {
        expiryDays: 30,   // 캐시 만료일 (일)
        keyPrefix: 'translate_' // 캐시 키 접두사
      },
      
      MESSAGE_TYPES: {
        TRANSLATE_PAGE: 'translatePage',
        OPEN_POPUP: 'openPopup',
        UPDATE_SETTINGS: 'updateSettings',
        USAGE_UPDATED: 'usageUpdated'
      },
      
      UI_SETTINGS: {
        statusTimeout: 2000, // 상태 메시지 표시 시간 (ms)
        limitExceededTimeout: 10000 // 한도 초과 알림 표시 시간 (ms)
      }
    };
    
  })(window);