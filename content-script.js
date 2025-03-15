// content-script.js - 개선된 버전 (모듈화된 구조 사용)
(function() {
  'use strict';
  
  // 초기화 플래그 확인 - 중복 실행 방지
  if (window.tonyTranslatorInitialized) {
    console.log("[번역 익스텐션] 이미 초기화되어 중복 실행 방지");
    return;
  }
  
  // 필요한 모듈 로드 확인 함수
  function ensureModulesLoaded(maxAttempts = 20, delay = 100) { // 더 짧은 간격으로 더 많은 시도
    return new Promise((resolve, reject) => {
      let attempts = 0;
      
      function checkModules() {
        try {
          // 먼저 DOMSelector 확인
          if (!window.DOMSelector) {
            throw new Error("DOMSelector 모듈이 로드되지 않았습니다.");
          }
          
          // 각 모듈 로드 확인 (존재 여부 + 실제 객체인지 확인)
          const modulesStatus = {
            DOMSelector: window.DOMSelector && typeof window.DOMSelector === 'object',
            DOMObserver: window.DOMObserver && typeof window.DOMObserver === 'object',
            DOMManipulator: window.DOMManipulator && typeof window.DOMManipulator === 'object',
            BatchEngine: window.BatchEngine && typeof window.BatchEngine === 'object',
            TranslatorService: window.TranslatorService && typeof window.TranslatorService === 'object',
            DOMHandler: window.DOMHandler && typeof window.DOMHandler === 'object'
          };
  
          // 모든 모듈이 로드되었는지 확인
          const allLoaded = Object.values(modulesStatus).every(status => status);
          
          if (allLoaded) {
            console.log("[번역 익스텐션] 필요한 모든 모듈이 로드되었습니다.");
            resolve(true);
            return;
          }
          
          // 아직 로드되지 않은 모듈이 있음
          attempts++;
          if (attempts >= maxAttempts) {
            // 로드되지 않은 모듈들 목록화
            const missingModules = Object.entries(modulesStatus)
              .filter(([_, loaded]) => !loaded)
              .map(([name]) => name);
              
            console.error(`[번역 익스텐션] 다음 모듈들이 로드되지 않았습니다: ${missingModules.join(', ')}`);
            
            // 각 모듈 상태 로깅
            Object.entries(modulesStatus).forEach(([name, loaded]) => {
              console.log(`${name}: ${loaded}`);
            });
            
            reject(new Error("모듈 로드 실패"));
            return;
          }
          
          console.log(`[번역 익스텐션] 모듈 로드 대기 중... (시도 ${attempts}/${maxAttempts})`);
          // 다시 시도
          setTimeout(checkModules, delay);
        } catch (error) {
          console.error("[번역 익스텐션] 모듈 확인 중 오류:", error);
          attempts++;
          if (attempts >= maxAttempts) {
            reject(error);
          } else {
            setTimeout(checkModules, delay);
          }
        }
      }
      
      checkModules();
    });
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
      
      if (window.DOMHandler) {
        window.DOMHandler.resetTranslationState();
      }
    }
  };
  
  /**
   * 이벤트 리스너 설정
   */
  function setupEventListeners() {
    // 번역 상태 변경 이벤트
    window.addEventListener('dom:translating-state-changed', function(event) {
      try {
        AppState.isTranslating = event.detail?.isTranslating === true;
      } catch (error) {
        console.warn("[번역 익스텐션] 번역 상태 이벤트 처리 오류:", error);
      }
    });
    
    // 크롬 메시지 리스너 설정 (확장 프로그램 컨텍스트가 유효한 경우에만)
    if (isExtensionContextValid()) {
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
  }
  
  /**
   * 설정 로드
   * @returns {Promise<Object>} - 설정 객체
   */
  async function loadSettings() {
    return new Promise((resolve, reject) => {
      if (!isExtensionContextValid()) {
        // 컨텍스트가 무효화된 경우 기본 설정 사용
        const defaultSettings = getDefaultSettings();
        AppState.settings = defaultSettings;
        
        // 설정을 각 모듈에 적용
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
            const settings = data?.settings ? { ...defaultSettings, ...data.settings } : defaultSettings;
            
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
      targetLang: 'ko',              // 번역 대상 언어
      autoTranslate: false,          // 페이지 로드 시 자동 번역
      translateFullPage: true,       // 전체 페이지 번역 모드
      immediateTranslation: true,    // 즉시 번역 모드
      minTextLength: 1,              // 최소 텍스트 길이
      batchSize: 50,                 // 배치 크기
      maxConcurrentBatches: 3,       // 최대 동시 배치 수
      highlightTranslated: false,    // 번역된 텍스트 강조 표시
      keepOriginalOnHover: true      // 마우스 오버 시 원본 텍스트 표시
    };
  }
  
  /**
   * 설정 각 모듈에 적용
   */
  function applySettings(settings) {
    if (!settings) return;
    
    // DOMHandler 설정 적용
    if (window.DOMHandler) {
      window.DOMHandler.updateSettings({
        minTextLength: settings.minTextLength,
        translateFullPage: settings.translateFullPage,
        immediateTranslation: settings.immediateTranslation,
        batchSize: settings.batchSize,
        maxConcurrentBatches: settings.maxConcurrentBatches,
        autoRefresh: true
      });
    }
    
    // DOMManipulator 설정 적용
    if (window.DOMManipulator) {
      window.DOMManipulator.updateSettings({
        highlightTranslated: settings.highlightTranslated,
        keepOriginalOnHover: settings.keepOriginalOnHover
      });
    }
    
    // TranslatorService 설정 적용
    if (window.TranslatorService) {
      window.TranslatorService.updateSettings({
        targetLang: settings.targetLang,
        workerEndpoint: 'https://translate-worker.redofyear2.workers.dev'
      });
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

    // 모듈 로드 확인
    try {
      await ensureModulesLoaded();

      // 설정 로드 (필요시)
      if (!AppState.settings) {
        await loadSettings();
      }

      // 번역 시작
      if (window.DOMHandler) {
        // 기존 번역 상태 초기화
        window.DOMHandler.resetTranslationState();
        
        // DOMHandler 모듈 초기화
        window.DOMHandler.initialize();
        
        // 전체 페이지 번역 모드 확인
        if (AppState.settings?.translateFullPage) {
          // 전체 페이지 번역
          await window.DOMHandler.translateFullPage();
        } else {
          // 화면에 보이는 부분만 번역
          await window.DOMHandler.translateVisibleElements();
        }
        
        return "번역이 시작되었습니다. 페이지 스크롤 시 추가 콘텐츠가 자동으로 번역됩니다.";
      } else {
        throw new Error("DOMHandler 모듈이 로드되지 않았습니다.");
      }
    } catch (error) {
      console.error("[번역 익스텐션] 모듈 로드 오류:", error);

      AppState.isTranslating = false;
      return `번역 오류: ${error.message || '알 수 없는 오류'}`;
    }
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
    } catch (error) {
      console.error("[번역 익스텐션] 자동 번역 설정 오류:", error);
    }
  }
  
  /**
   * 애플리케이션 초기화
   */
  async function initializeApp() {
    try {
      console.log("[번역 익스텐션] 애플리케이션 초기화 시작...");

      // 모듈 존재 여부 먼저 확인 (실제 로드 전에)
      if (!window.DOMSelector) {
        console.log("[번역 익스텐션] DOMSelector 모듈이 없습니다. 스크립트를 직접 로드합니다.");
        
          // 필요시 여기서 스크립트를 동적으로 로드할 수 있음
          // 하지만 확장 프로그램에서는 manifest.json에서 순서를 조정하는 것이 더 효과적
      }
        
      // 모듈 로드 확인을 위해 더 긴 시간 대기
      await ensureModulesLoaded();
      
      // 초기화 플래그 설정
      window.tonyTranslatorInitialized = true;
      
      // 이벤트 리스너 설정
      setupEventListeners();
      
      // 설정 로드
      await loadSettings();
      
      // 자동 번역 설정
      setupAutoTranslate();
      
      // 필요한 기능을 전역으로 노출
      window.tonyTranslator = {
        translatePage,
        getSettings: () => AppState.settings,
        resetState: () => AppState.reset()
      };
      
      console.log("[번역 익스텐션] 애플리케이션 초기화 완료");
      return true;
    } catch (error) {
      console.error("[번역 익스텐션] 애플리케이션 초기화 실패:", error);
      return false;
    }
  }
  
  // 초기 로드 지연: DOM 완전히 로드된 후 모듈 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // DOM 로드 후 짧은 지연 추가하여 모든 모듈이 준비될 시간 제공
      setTimeout(() => {
        initializeApp().catch(error => {
          console.error("[번역 익스텐션] 초기화 실패:", error);
        });
      }, 500);
    });
  } else {
    // 이미 DOM 로드 완료된 경우 약간의 지연 후 초기화
    setTimeout(() => {
      initializeApp().catch(error => {
        console.error("[번역 익스텐션] 초기화 실패:", error);
      });
    }, 500);
  }
  
})();