// content-script.js - 더 근본적인 수정 버전
(function() {
  'use strict';
  
  // 모듈 전역 에러 처리 추가
  window.addEventListener('error', function(event) {
    console.error('[번역 익스텐션] 전역 오류 발생:', event.error);
  });
  
  // 초기화 플래그 확인 - 함수 내부 최상단에 위치
  if (window.tonyTranslatorInitialized) {
    console.log("[번역 익스텐션] 이미 초기화되어 중복 실행 방지");
    return; // 이미 초기화되었다면 함수 실행 중단
  }
  
  // 기존 함수 유지하되 개선
  function ensureModulesLoaded(maxAttempts = 10, delay = 200) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      
      function checkModules() {
        // 모듈 상태 출력 (모든 시도에서)
        if (attempts > 0) {
          console.log("[번역 익스텐션] 모듈 로드 상태 확인 (#" + attempts + "):");
          console.log("- DOMSelector:", typeof window.DOMSelector !== 'undefined');
          console.log("- DOMObserver:", typeof window.DOMObserver !== 'undefined');
          console.log("- DOMManipulator:", typeof window.DOMManipulator !== 'undefined');
          console.log("- BatchEngine:", typeof window.BatchEngine !== 'undefined');
          console.log("- TranslatorService:", typeof window.TranslatorService !== 'undefined');
          console.log("- CacheManager:", typeof window.CacheManager !== 'undefined');
          console.log("- UsageManager:", typeof window.UsageManager !== 'undefined');
        }
        
        // 핵심 모듈 확인
        const allModulesLoaded = 
          typeof window.DOMSelector !== 'undefined' &&
          typeof window.DOMObserver !== 'undefined' &&
          typeof window.DOMManipulator !== 'undefined' &&
          typeof window.BatchEngine !== 'undefined' &&
          typeof window.TranslatorService !== 'undefined' &&
          typeof window.CacheManager !== 'undefined' &&
          typeof window.UsageManager !== 'undefined' &&
          typeof window.DOMHandler !== 'undefined';
        
        if (allModulesLoaded) {
          console.log("[번역 익스텐션] 모든 모듈이 정상적으로 로드되었습니다!");
          resolve(true);
          return;
        }
        
        attempts++;
        if (attempts >= maxAttempts) {
          console.error("[번역 익스텐션] 필요한 모듈이 로드되지 않았습니다. 로드 순서를 확인하세요.");
          
          // 누락된 모듈 목록 생성
          const missingModules = [];
          if (typeof window.DOMSelector === 'undefined') missingModules.push("utils/dom/dom-selector.js");
          if (typeof window.DOMObserver === 'undefined') missingModules.push("utils/dom/dom-observer.js");
          if (typeof window.DOMManipulator === 'undefined') missingModules.push("utils/dom/dom-manipulator.js");
          if (typeof window.BatchEngine === 'undefined') missingModules.push("utils/batch/batch_engine.js");
          
          // 마지막 시도: 누락된 모듈 로드 요청
          if (missingModules.length > 0) {
            console.log("[번역 익스텐션] 누락된 모듈 로드 시도:", missingModules);
            
            try {
              chrome.runtime.sendMessage({ 
                action: "loadScripts", 
                scripts: missingModules
              }, (response) => {
                console.log("[번역 익스텐션] 모듈 로드 요청 응답:", response);
                // 추가 대기 후 다시 한번 체크 시도
                setTimeout(() => {
                  if (window.DOMSelector && 
                      window.DOMObserver && 
                      window.DOMManipulator && 
                      window.BatchEngine) {
                    console.log("[번역 익스텐션] 모듈 수동 로드 성공!");
                    resolve(true);
                  } else {
                    reject(new Error("모듈 로드 실패"));
                  }
                }, 1000);
              });
              return; // 추가 시간 제공을 위해 즉시 반환
            } catch (e) {
              console.error("[번역 익스텐션] 모듈 로드 요청 오류:", e);
            }
          }
          
          reject(new Error("모듈 로드 실패"));
          return;
        }
        
        // 다시 시도
        setTimeout(checkModules, delay);
      }
      
      checkModules();
    });
  }

// 자동 모듈 상태 확인 (새로 추가할 함수)
function checkModuleStatus() {
  console.log("[번역 익스텐션] 모듈 로드 상태 확인:");
  console.log("- DOMHandler:", typeof window.DOMHandler !== 'undefined' ? "로드됨" : "누락");
  console.log("- TranslatorService:", typeof window.TranslatorService !== 'undefined' ? "로드됨" : "누락");
  console.log("- CacheManager:", typeof window.CacheManager !== 'undefined' ? "로드됨" : "누락");
  console.log("- UsageManager:", typeof window.UsageManager !== 'undefined' ? "로드됨" : "누락");
  console.log("- UIManager:", typeof window.UIManager !== 'undefined' ? "로드됨" : "누락");
  console.log("- DOMSelector:", typeof window.DOMSelector !== 'undefined' ? "로드됨" : "누락");
  console.log("- DOMObserver:", typeof window.DOMObserver !== 'undefined' ? "로드됨" : "누락");
  console.log("- DOMManipulator:", typeof window.DOMManipulator !== 'undefined' ? "로드됨" : "누락");
  console.log("- BatchEngine:", typeof window.BatchEngine !== 'undefined' ? "로드됨" : "누락");
}

// 페이지 로드 시 모듈 상태 확인 (선택적으로 추가)
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(checkModuleStatus, 500);
});
  
  // 안전한 이벤트 핸들러 래퍼 함수
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
        console.error(`[번역 익스텐션] ${eventName} 이벤트 처리 중 오류:`, error);
      }
    };
  }
  
  // 안전한 이벤트 디스패치 함수
  function safeDispatchEvent(eventName, detail = {}) {
    try {
      const event = new CustomEvent(eventName, { 
        detail: detail || {} // null/undefined 방지
      });
      window.dispatchEvent(event);
      return true;
    } catch (error) {
      console.error(`[번역 익스텐션] 이벤트 발행 오류 (${eventName}):`, error);
      return false;
    }
  }
  
  // 확장 프로그램 상태 확인
  function isExtensionContextValid() {
    try {
      // 크롬 API 접근이 가능한지 확인 (컨텍스트 유효성 테스트)
      chrome.runtime.getManifest();
      return true;
    } catch (e) {
      // "Extension context invalidated" 오류 감지
      if (e.message && e.message.includes('Extension context invalidated')) {
        console.warn('[번역 익스텐션] 확장 프로그램 컨텍스트가 무효화되었습니다. 페이지 새로고침이 필요합니다.');
        return false;
      }
      return true; // 다른 오류는 컨텍스트 자체가 무효화된 것은 아님
    }
  }
  
  // 애플리케이션 상태 관리
  const AppState = {
    isTranslating: false,
    settings: null,
    pendingTranslation: false,
    
    /**
     * 상태 초기화
     */
    reset() {
      this.isTranslating = false;
      this.pendingTranslation = false;
      
      if (window.DOMHandler && typeof window.DOMHandler.resetTranslationState === 'function') {
        try {
          window.DOMHandler.resetTranslationState();
        } catch (error) {
          console.error("[번역 익스텐션] 상태 초기화 오류:", error);
        }
      }
    }
  };
  
  /**
   * 번역할 텍스트 노드 처리 (주요 수정 대상)
   * @param {Array} nodeInfoList - 텍스트 노드 정보 배열
   * @param {Array} elements - 번역 대상 요소 배열
   * @returns {Promise<number>} - 번역된 텍스트 수
   */
  async function processTextNodes(nodeInfoList, elements) {
    // 입력 검증
    if (!nodeInfoList || !Array.isArray(nodeInfoList) || nodeInfoList.length === 0) {
      console.warn("[번역 익스텐션] 유효하지 않은 노드 정보 목록:", nodeInfoList);
      return 0;
    }
    
    // 이미 번역 중이면 대기
    if (AppState.pendingTranslation) {
      console.log("[번역 익스텐션] 이미 번역 작업이 대기 중입니다.");
      return 0;
    }
    
    // 모듈 유효성 검사
    if (!window.TranslatorService || !window.DOMHandler) {
      console.error("[번역 익스텐션] 필수 번역 모듈이 없습니다.");
      return 0;
    }
    
    AppState.pendingTranslation = true;
    
    try {
      // 텍스트 배열 추출
      const textsToTranslate = nodeInfoList.map(item => item.text || "");
      
      // 번역 이벤트 리스너 등록 (안전한 버전)
      const batchCompleteListener = createSafeEventListener('translation:batch-complete', 
        (event, detail) => {
          if (detail) {
            const total = detail.total || 0;
            const completed = detail.completed || 0;
            const cachedCount = detail.cachedCount || 0;
            const newCount = detail.newCount || 0;
            
            if (window.UIManager && typeof window.UIManager.showTranslationStatus === 'function') {
              window.UIManager.showTranslationStatus(
                `${total}개 항목 번역 중... (${completed}/${total} 배치, 캐시: ${cachedCount}, 신규: ${newCount})`
              );
            }
          }
        }
      );
      
      // 이벤트 리스너 등록
      window.addEventListener('translation:batch-complete', batchCompleteListener);
      
      // 배치 처리를 통한 번역
      const translatedItems = await window.TranslatorService.translateInBatches(
        textsToTranslate, 
        (AppState.settings && AppState.settings.batchSize) || 40, 
        (AppState.settings && AppState.settings.maxConcurrentBatches) || 3
      );
      
      // 이벤트 리스너 제거
      window.removeEventListener('translation:batch-complete', batchCompleteListener);
      
      // 번역 결과가 없으면 종료
      if (!translatedItems || !Array.isArray(translatedItems)) {
        console.warn("[번역 익스텐션] 번역 결과가 없습니다.");
        AppState.pendingTranslation = false;
        return 0;
      }
      
      // 번역 결과를 DOM에 적용하기 위한 형식으로 변환
      const translationDataForDOM = translatedItems.map((item, index) => {
        // 인덱스가 범위를 벗어나면 빈 객체 반환
        if (!nodeInfoList[index]) return { original: "", translated: "", xpath: "" };
        
        return {
          original: item.original || "",
          translated: item.translated || "",
          xpath: nodeInfoList[index].xpath || ""
        };
      }).filter(item => item.xpath); // 빈 xpath 항목 제거
      
      // 번역된 텍스트 DOM에 적용
      const replacedCount = window.DOMHandler.replaceTextsInDOM(
        translationDataForDOM, 
        Array.isArray(elements) ? elements : []
      );
      
      AppState.pendingTranslation = false;
      
      return replacedCount;
    } catch (error) {
      console.error("[번역 익스텐션] 텍스트 노드 처리 오류:", error);
      AppState.pendingTranslation = false;
      return 0;
    }
  }
  
  /**
   * 이벤트 리스너 설정 (주요 수정 대상)
   */
  function setupEventListeners() {
    // 텍스트 노드 준비됨 이벤트 리스너 (가장 중요한 문제 영역)
    window.addEventListener('dom:textnodes-ready', createSafeEventListener(
      'dom:textnodes-ready',
      (event, detail) => {
        // detail이 없을 경우 기본값 사용
        const safeDetail = detail || {};
        const nodes = safeDetail.nodes || [];
        const elements = safeDetail.elements || [];
        
        // 값의 유효성 확인
        if (nodes.length > 0) {
          processTextNodes(nodes, elements).catch(error => {
            console.error("[번역 익스텐션] 노드 처리 오류:", error);
          });
        } else {
          console.warn("[번역 익스텐션] 텍스트 노드 이벤트에 노드가 없습니다.");
        }
      }
    ));
    
    // 번역 한도 초과 이벤트 리스너
    window.addEventListener('usage:limit-exceeded', createSafeEventListener(
      'usage:limit-exceeded',
      () => {
        if (window.UIManager && typeof window.UIManager.showTranslationLimitExceeded === 'function') {
          window.UIManager.showTranslationLimitExceeded(() => {
            if (isExtensionContextValid()) {
              chrome.runtime.sendMessage({ action: "openPopup" });
            }
          });
        }
      }
    ));
    
    // DOM 관련 이벤트 리스너
    window.addEventListener('dom:translating-state-changed', createSafeEventListener(
      'dom:translating-state-changed',
      (event, detail) => {
        const isTranslating = detail.isTranslating === true;
        AppState.isTranslating = isTranslating;
      }
    ));
    
    // 번역 완료 이벤트 리스너
    window.addEventListener('dom:text-replaced', createSafeEventListener(
      'dom:text-replaced',
      (event, detail) => {
        // 특별한 처리 필요 시 여기에 추가
        const count = detail.count || 0;
        console.log(`[번역 익스텐션] ${count}개 텍스트 교체됨`);
      }
    ));
  }
  
  /**
   * 번역 확장 초기화 메인 함수
   */
  async function initializeTranslator() {
    try {
      // 모듈 로드 확인 (비동기적으로 대기)
      await ensureModulesLoaded();
      
      // 초기화 표시 - 플래그 설정
      window.tonyTranslatorInitialized = true;
      
      // 이벤트 리스너 설정
      setupEventListeners();
      
      // 크롬 메시지 리스너 설정 (확장 프로그램 컨텍스트가 유효한 경우에만)
      if (isExtensionContextValid()) {
        setupMessageListeners();
      }
      
      // 설정 로드
      await loadSettings();
      
      // 자동 번역 설정
      setupAutoTranslate();
      
      // 페이지 언로드 시 리소스 정리
      window.addEventListener('beforeunload', () => {
        try {
          if (window.DOMHandler && typeof window.DOMHandler.cleanup === 'function') {
            window.DOMHandler.cleanup();
          }
        } catch (error) {
          console.error("[번역 익스텐션] 리소스 정리 오류:", error);
        }
      });
      
      // 필요한 기능을 전역으로 노출
      window.tonyTranslator = {
        translatePage,
        getSettings: () => AppState.settings,
        safeDispatchEvent
      };
      
      console.log("[번역 익스텐션] 초기화 완료");
      return true;
    } catch (error) {
      console.error("[번역 익스텐션] 초기화 실패:", error);
      return false;
    }
  }
  
  /**
   * 설정 로드
   * @returns {Promise<Object>} - 설정 객체
   */
  async function loadSettings() {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        // 컨텍스트가 무효화된 경우 기본 설정 사용
        const defaultSettings = getDefaultSettings();
        AppState.settings = defaultSettings;
        applySettings(defaultSettings);
        resolve(defaultSettings);
        return;
      }
      
      try {
        chrome.storage.sync.get('settings', (data) => {
          try {
            // 기본 설정
            const defaultSettings = getDefaultSettings();
            
            // 사용자 설정과 기본 설정 병합
            const settings = data && data.settings ? { ...defaultSettings, ...data.settings } : defaultSettings;
            
            // 설정 적용
            applySettings(settings);
            
            AppState.settings = settings;
            resolve(settings);
          } catch (innerError) {
            console.error("[번역 익스텐션] 설정 처리 오류:", innerError);
            
            // 오류 시 기본 설정 사용
            const defaultSettings = getDefaultSettings();
            AppState.settings = defaultSettings;
            applySettings(defaultSettings);
            resolve(defaultSettings);
          }
        });
      } catch (error) {
        console.error("[번역 익스텐션] 설정 로드 오류:", error);
        
        // 오류 시 기본 설정 사용
        const defaultSettings = getDefaultSettings();
        AppState.settings = defaultSettings;
        applySettings(defaultSettings);
        resolve(defaultSettings);
      }
    });
  }
  
  /**
   * 기본 설정 가져오기
   */
  function getDefaultSettings() {
    return {
      targetLang: 'ko',
      autoTranslate: false,
      minTextLength: 2,
      batchSize: 40,
      maxConcurrentBatches: 3,
      rootMargin: '200px',
      textContainerSelector: 'p, h1, h2, h3, h4, h5, h6, li, span, a, td, th, caption, label, button, div:not(:empty)',
      ignoreSelector: 'script, style, noscript, code, pre'
    };
  }
  
  /**
   * 설정 각 모듈에 적용
   */
  function applySettings(settings) {
    if (!settings) return;
    
    // 각 모듈에 설정 전달
    if (window.TranslatorService && typeof window.TranslatorService.updateSettings === 'function') {
      try {
        window.TranslatorService.updateSettings({ 
          targetLang: settings.targetLang,
          workerEndpoint: 'https://translate-worker.redofyear2.workers.dev'
        });
      } catch (error) {
        console.error("[번역 익스텐션] TranslatorService 설정 오류:", error);
      }
    }
    
    if (window.DOMHandler && typeof window.DOMHandler.updateSettings === 'function') {
      try {
        window.DOMHandler.updateSettings({
          minTextLength: settings.minTextLength,
          rootMargin: settings.rootMargin,
          textContainerSelector: settings.textContainerSelector,
          ignoreSelector: settings.ignoreSelector
        });
      } catch (error) {
        console.error("[번역 익스텐션] DOMHandler 설정 오류:", error);
      }
    }
    
    if (window.CacheManager && typeof window.CacheManager.updateSettings === 'function') {
      try {
        window.CacheManager.updateSettings({
          expiryDays: 30  // 캐시 만료일 설정
        });
      } catch (error) {
        console.error("[번역 익스텐션] CacheManager 설정 오류:", error);
      }
    }
    
    if (window.UIManager && typeof window.UIManager.updateSettings === 'function') {
      try {
        window.UIManager.updateSettings({
          statusTimeout: 2000,
          limitExceededTimeout: 10000
        });
      } catch (error) {
        console.error("[번역 익스텐션] UIManager 설정 오류:", error);
      }
    }
  }
  
  /**
   * 웹페이지 번역 프로세스
   * @returns {Promise<string>} - 번역 결과 메시지
   */
  async function translatePage() {
    console.log("[번역 익스텐션] 페이지 번역 시작");
    
    // 이미 번역 중이면 중복 실행 방지
    if (AppState.isTranslating) {
      return "이미 번역 중입니다.";
    }
    
    // 컨텍스트 확인
    if (!isExtensionContextValid()) {
      console.warn("[번역 익스텐션] 확장 프로그램 컨텍스트가 무효화됨");
      return "확장 프로그램 컨텍스트 오류. 페이지를 새로고침 해주세요.";
    }
    
    // 필수 모듈 확인
    if (!window.DOMHandler || !window.UIManager) {
      console.error("[번역 익스텐션] 필수 모듈이 로드되지 않음");
      return "필수 모듈이 로드되지 않았습니다.";
    }
    
    // 번역 상태 설정
    AppState.isTranslating = true;
    window.DOMHandler.setTranslatingState(true);
    
    // 번역 진행 상태 표시
    window.UIManager.showTranslationStatus("번역 준비 중...");
    
    try {
      // 설정 로드 (필요시)
      if (!AppState.settings) {
        await loadSettings();
      }
      
      // 기존 번역 상태 초기화
      window.DOMHandler.resetTranslationState();
      
      // IntersectionObserver 기반 번역 시스템 초기화
      window.DOMHandler.initialize();
      
      window.UIManager.showTranslationStatus("번역 진행 중...");
      
      // 완료 메시지 표시 (IntersectionObserver가 비동기적으로 번역 시작)
      setTimeout(() => {
        if (AppState.isTranslating) {
          window.UIManager.showTranslationStatus("페이지 스크롤 시 추가 콘텐츠가 자동으로 번역됩니다.", true);
          
          // 일정 시간 후 상태 메시지 숨기기
          setTimeout(() => {
            window.UIManager.hideTranslationStatus();
            
            // 번역 상태 업데이트
            AppState.isTranslating = false;
            window.DOMHandler.setTranslatingState(false);
          }, 3000);
        }
      }, 1000);
      
      return "번역이 시작되었습니다. 페이지 스크롤 시 추가 콘텐츠가 자동으로 번역됩니다.";
    } catch (error) {
      console.error("[번역 익스텐션] 번역 오류:", error);
      try {
        window.UIManager.hideTranslationStatus();
      } catch (e) {}
      
      AppState.isTranslating = false;
      try {
        window.DOMHandler.setTranslatingState(false);
      } catch (e) {}
      
      return `번역 오류: ${error.message || '알 수 없는 오류'}`;
    }
  }
  
  /**
   * 크롬 메시지 리스너 설정
   */
  function setupMessageListeners() {
    // 컨텍스트가 유효하지 않으면 실행하지 않음
    if (!isExtensionContextValid()) return;
    
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      try {
        // ping 메시지 - 컨텐츠 스크립트가 로드되었는지 확인용
        if (request.action === "ping") {
          sendResponse({ status: "ready" });
          return true;
        }
        
        // 번역 요청
        if (request.action === "translatePage") {
          translatePage().then(result => {
            if (isExtensionContextValid()) {
              sendResponse({ success: true, result });
            }
          }).catch(error => {
            console.error("[번역 익스텐션] 오류:", error);
            if (isExtensionContextValid()) {
              sendResponse({ success: false, error: error.message || '알 수 없는 오류' });
            }
          });
          return true; // 비동기 응답을 위해 true 반환
        }
        
        // 설정 업데이트
        if (request.action === "updateSettings") {
          loadSettings().then(() => {
            // 설정 변경 후 번역 시스템 재초기화
            if (document.body && window.DOMHandler) {
              window.DOMHandler.resetTranslationState();
              window.DOMHandler.initialize();
            }
            
            if (isExtensionContextValid()) {
              sendResponse({ success: true });
            }
          }).catch(error => {
            console.error("[번역 익스텐션] 설정 업데이트 오류:", error);
            if (isExtensionContextValid()) {
              sendResponse({ success: false, error: error.message || '알 수 없는 오류' });
            }
          });
          return true;
        }
      } catch (error) {
        console.error("[번역 익스텐션] 메시지 처리 오류:", error);
        // 컨텍스트가 여전히 유효하면 응답 시도
        if (isExtensionContextValid()) {
          sendResponse({ success: false, error: error.message || '알 수 없는 오류' });
        }
        return true;
      }
      
      return false;
    });
  }
  
  /**
   * 페이지 로드 완료 시 자동 번역 설정
   */
  function setupAutoTranslate() {
    try {
      const autoTranslateHandler = () => {
        // 설정 로드
        loadSettings().then(settings => {
          if (settings && settings.autoTranslate) {
            translatePage().catch(error => {
              console.error("[번역 익스텐션] 자동 번역 오류:", error);
            });
          }
        }).catch(error => {
          console.error("[번역 익스텐션] 설정 로드 오류:", error);
        });
      };
      
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoTranslateHandler);
      } else {
        // 이미 DOM이 로드된 경우
        autoTranslateHandler();
      }
      
      // 주기적으로 오래된 캐시 정리
      setTimeout(() => {
        try {
          if (window.CacheManager && typeof window.CacheManager.cleanupExpired === 'function') {
            window.CacheManager.cleanupExpired();
          }
        } catch (error) {
          console.error("[번역 익스텐션] 캐시 정리 오류:", error);
        }
      }, 10000);
    } catch (error) {
      console.error("[번역 익스텐션] 자동 번역 설정 오류:", error);
    }
  }
  
  // 애플리케이션 초기화 (비동기)
  initializeTranslator().catch(error => {
    console.error("[번역 익스텐션] 초기화 실패:", error);
  });
  
})();