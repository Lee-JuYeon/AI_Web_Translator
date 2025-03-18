// config.js - ES Module version
'use strict';

// 앱 버전 정보
const APP_VERSION = '1.0.0';

// 확장 프로그램 설정
const APP_CONFIG = {
  // 메뉴 및 ID 관련
  menuItemId: 'tony_translate',
  appName: 'Tony번역',
  
  // 모듈 파일 경로 정보
  moduleImports: {
    CacheManager: '/utils/cache-manager.js',
    UsageManager: '/utils/usage-manager.js',
    UIManager: '/utils/ui-manager.js',
    DOMSelector: '/utils/dom/dom-selector.js',
    DOMObserver: '/utils/dom/dom-observer.js',
    DOMManipulator: '/utils/dom/dom-manipulator.js',
    BatchEngine: '/utils/batch/batch_engine.js',
    TranslatorService: '/utils/translator-service.js',
    DOMHandler: '/utils/dom/dom-handler.js'
  },
  
  // API 관련 설정
  apiEndpoint: 'https://translate-worker.redofyear2.workers.dev',
  translateSeparator: '||TRANSLATE_SEPARATOR||',
  
  // 구독 등급별 월간 토큰 한도
  subscriptionLimits: {
    FREE: 15000,   // 무료 회원: 약 15,000 토큰 (약 30페이지)
    BASIC: 100000  // 기본 회원($5): 약 100,000 토큰 (약 200페이지)
  },
  
  // 기본 설정 값
  defaultSettings: {
    targetLang: 'ko',        // 기본 번역 언어
    autoTranslate: false,    // 자동 번역 여부
    batchSize: 40,           // 배치 크기
    maxConcurrentBatches: 3, // 최대 동시 배치 수
    minTextLength: 2,        // 최소 텍스트 길이
    translateFullPage: true, // 전체 페이지 번역
    immediateTranslation: true // 즉시 번역
  },
  
  // DOM 관련 설정
  domAttributes: {
    translatedAttr: 'data-tony-translated',
    pendingAttr: 'data-tony-pending',
    sourceAttr: 'data-tony-source',
    translationClass: 'tony-translated'
  },
  
  // API 요청 관련 설정
  apiSettings: {
    timeout: 20000,    // 요청 타임아웃 (ms)
    maxRetryCount: 2,  // 최대 재시도 횟수
    retryDelay: 1000   // 재시도 지연 시간 (ms)
  },
  
  // UI 관련 설정
  uiSettings: {
    statusTimeout: 2000,
    limitExceededTimeout: 10000,
    autoHideDelay: 3000,
    progressUpdateInterval: 1000
  },
  
  // 캐시 관련 설정
  cacheSettings: {
    expiryDays: 30,
    keyPrefix: 'translate_'
  }
};

/**
 * 브라우저 언어 설정 가져오기
 * @returns {string} - 언어 코드
 */
function getBrowserLanguage() {
  const browserLang = navigator.language.split('-')[0];
  
  // 지원하는 언어인지 확인 (동적으로 로드 불가능하므로 기본 목록 사용)
  const supportedLanguages = ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de'];
  
  return supportedLanguages.includes(browserLang) ? browserLang : 'ko';
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
 * 버전 비교 함수
 * @param {string} v1 - 버전 1
 * @param {string} v2 - 버전 2
 * @returns {number} - 비교 결과 (-1: v1 < v2, 0: v1 = v2, 1: v1 > v2)
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = i < parts1.length ? parts1[i] : 0;
    const num2 = i < parts2.length ? parts2[i] : 0;
    
    if (num1 < num2) return -1;
    if (num1 > num2) return 1;
  }
  
  return 0;
}

/**
 * 안전한 이벤트 발행 함수
 * @param {string} eventName - 이벤트 이름
 * @param {Object} detail - 이벤트 detail 객체
 * @returns {boolean} - 이벤트 발행 성공 여부
 */
function safeDispatchEvent(eventName, detail = {}) {
  try {
    const event = new CustomEvent(eventName, { 
      detail: detail || {} // null/undefined 방지
    });
    window.dispatchEvent(event);
    return true;
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 이벤트 발행 오류 (${eventName}):`, error);
    return false;
  }
}

/**
 * 안전한 이벤트 핸들러 래퍼 함수
 * @param {string} eventName - 이벤트 이름
 * @param {Function} handler - 핸들러 함수
 */
function createSafeEventListener(eventName, handler) {
  return function safeHandler(event) {
    try {
      // 이벤트나 detail이 없으면 기본 객체 제공
      const safeEvent = event || { type: eventName };
      const safeDetail = (safeEvent.detail !== null && safeEvent.detail !== undefined) 
        ? safeEvent.detail 
        : {};
        
      // 핸들러 호출 시 안전한 이벤트와 디테일 전달
      handler(safeEvent, safeDetail);
    } catch (error) {
      console.error(`[${APP_CONFIG.appName}] ${eventName} 이벤트 처리 중 오류:`, error);
    }
  };
}

/**
 * 확장 프로그램 상태 확인
 * @returns {boolean} 컨텍스트 유효 여부
 */
function isExtensionContextValid() {
  try {
    // 크롬 API 접근이 가능한지 확인 (컨텍스트 유효성 테스트)
    chrome.runtime.getManifest();
    return true;
  } catch (e) {
    // "Extension context invalidated" 오류 감지
    if (e.message && e.message.includes('Extension context invalidated')) {
      console.warn(`[${APP_CONFIG.appName}] 확장 프로그램 컨텍스트가 무효화되었습니다. 페이지 새로고침이 필요합니다.`);
      return false;
    }
    return true; // 다른 오류는 컨텍스트 자체가 무효화된 것은 아님
  }
}

/**
 * 모듈 로드 확인 함수
 * @param {string[]} moduleNames - 확인할 모듈 이름 배열
 * @param {Object} moduleObjects - 로드된 모듈 객체들
 * @returns {boolean} - 모든 모듈 로드 여부
 */
function areModulesLoaded(moduleNames, moduleObjects) {
  return moduleNames.every(name => typeof moduleObjects[name] !== 'undefined');
}

/**
 * 동적으로 모듈 가져오기
 * @param {string} modulePath - 모듈 경로
 * @returns {Promise<any>} - 모듈 객체
 */
async function importModule(modulePath) {
  try {
    const url = chrome.runtime.getURL(modulePath);
    return await import(url);
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 모듈 가져오기 오류 (${modulePath}):`, error);
    throw error;
  }
}

// 공개 API
export {
  APP_VERSION,
  APP_CONFIG,
  getBrowserLanguage,
  getCurrentMonth,
  compareVersions,
  safeDispatchEvent,
  createSafeEventListener,
  isExtensionContextValid,
  areModulesLoaded,
  importModule
};