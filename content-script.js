// content-script.js - 리팩토링 버전
(function() {
  'use strict';
  
  // 초기화 플래그 확인 - 함수 내부 최상단에 위치
  if (window.tonyTranslatorInitialized) {
    console.log("[번역 익스텐션] 이미 초기화되어 중복 실행 방지");
    return; // 이미 초기화되었다면 함수 실행 중단
  }
  
  // 초기화 표시 - 플래그 설정
  window.tonyTranslatorInitialized = true;
  
  // 애플리케이션 상태 관리
  const AppState = {
    isTranslating: false,
    settings: null,
    
    /**
     * 상태 초기화
     */
    reset() {
      this.isTranslating = false;
      DOMHandler.resetProcessedNodes();
    }
  };
  
  /**
   * 설정 로드
   * @returns {Promise<Object>} - 설정 객체
   */
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('settings', (data) => {
        // 기본 설정
        const defaultSettings = {
          targetLang: 'ko',
          autoTranslate: false,
          minTextLength: 2,
          batchSize: 40,
          maxConcurrentBatches: 3,
          scrollThreshold: 200
        };
        
        // 사용자 설정과 기본 설정 병합
        const settings = data.settings ? { ...defaultSettings, ...data.settings } : defaultSettings;
        
        // 각 모듈에 설정 전달
        if (window.TranslatorService) {
          TranslatorService.updateSettings({ 
            targetLang: settings.targetLang,
            workerEndpoint: 'https://translate-worker.redofyear2.workers.dev'
          });
        }
        
        if (window.DOMHandler) {
          DOMHandler.updateSettings({
            minTextLength: settings.minTextLength,
            scrollThreshold: settings.scrollThreshold
          });
        }
        
        if (window.CacheManager) {
          CacheManager.updateSettings({
            expiryDays: 30  // 캐시 만료일 설정
          });
        }
        
        AppState.settings = settings;
        resolve(settings);
      });
    });
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
    
    // 번역 상태 설정
    AppState.isTranslating = true;
    DOMHandler.setTranslatingState(true);
    
    // 번역 진행 상태 표시
    DOMHandler.showTranslationStatus("번역 준비 중...");
    
    try {
      // 설정 로드
      if (!AppState.settings) {
        await loadSettings();
      }
      
      // 스크롤 이벤트 리스너 등록
      DOMHandler.setupScrollListener(() => {
        translateVisibleContent();
      });
      
      // 현재 화면에 보이는 텍스트 노드 추출 및 번역
      await translateVisibleContent();
      
      // 완료 메시지 표시
      DOMHandler.showTranslationStatus("번역 완료!", true);
      setTimeout(() => {
        DOMHandler.hideTranslationStatus();
      }, 2000);
      
      // 번역 상태 업데이트
      AppState.isTranslating = false;
      DOMHandler.setTranslatingState(false);
      
      return "현재 보이는 콘텐츠 번역 완료. 스크롤 시 추가 콘텐츠가 번역됩니다.";
    } catch (error) {
      DOMHandler.hideTranslationStatus();
      AppState.isTranslating = false;
      DOMHandler.setTranslatingState(false);
      console.error("[번역 익스텐션] 번역 오류:", error);
      throw error;
    }
  }
  
  /**
   * 현재 화면에 보이는 콘텐츠 번역
   * @returns {Promise<string>} - 번역 결과 메시지
   */
  async function translateVisibleContent() {
    AppState.isTranslating = true;
    DOMHandler.setTranslatingState(true);
    
    try {
      // 현재 화면에 보이는 노드 추출
      const nodeInfoList = DOMHandler.extractVisibleTextNodes(document.body);
      console.log(`[번역 익스텐션] 화면에 보이는 텍스트 노드: ${nodeInfoList.length}개`);
      
      if (nodeInfoList.length === 0) {
        AppState.isTranslating = false;
        DOMHandler.setTranslatingState(false);
        return "번역할 새 텍스트가 없습니다.";
      }
      
      // 텍스트 배열 추출
      const textsToTranslate = nodeInfoList.map(item => item.text);
      
      // 텍스트 번역 (배치 처리)
      DOMHandler.showTranslationStatus(`${textsToTranslate.length}개 항목 번역 중...`);
      
      // 번역 이벤트 리스너 등록
      const batchCompleteListener = (event) => {
        const detail = event.detail;
        DOMHandler.showTranslationStatus(
          `${detail.total}개 항목 번역 중... (${detail.completed}/${detail.total} 배치, 캐시: ${detail.cachedCount}, 신규: ${detail.newCount})`
        );
      };
      
      const translationErrorListener = (event) => {
        const detail = event.detail;
        console.error("[번역 익스텐션] 번역 오류:", detail.error);
      };
      
      // 이벤트 리스너 등록
      window.addEventListener('translation:batch-complete', batchCompleteListener);
      window.addEventListener('translation:error', translationErrorListener);
      
      // 배치 처리를 통한 번역
      const translatedItems = await TranslatorService.translateInBatches(
        textsToTranslate, 
        AppState.settings.batchSize, 
        AppState.settings.maxConcurrentBatches
      );
      
      // 이벤트 리스너 제거
      window.removeEventListener('translation:batch-complete', batchCompleteListener);
      window.removeEventListener('translation:error', translationErrorListener);
      
      // 번역 결과를 DOM에 적용하기 위한 형식으로 변환
      const translationDataForDOM = translatedItems.map((item, index) => ({
        original: item.original,
        translated: item.translated,
        xpath: nodeInfoList[index].xpath
      }));
      
      // 번역된 텍스트 DOM에 적용
      DOMHandler.showTranslationStatus(`번역 결과 적용 중...`);
      const replacedCount = DOMHandler.replaceTextsInDOM(translationDataForDOM);
      
      // 완료 메시지 표시
      DOMHandler.showTranslationStatus(
        `번역 완료! (총 ${replacedCount}개 항목 적용)`, 
        true
      );
      
      // 상태 업데이트
      AppState.isTranslating = false;
      DOMHandler.setTranslatingState(false);
      
      return `${replacedCount}개 항목 번역 완료`;
    } catch (error) {
      AppState.isTranslating = false;
      DOMHandler.setTranslatingState(false);
      throw error;
    }
  }
  
  /**
   * 크롬 메시지 리스너 설정
   */
  function setupMessageListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // ping 메시지 - 컨텐츠 스크립트가 로드되었는지 확인용
      if (request.action === "ping") {
        sendResponse({ status: "ready" });
        return true;
      }
      
      // 번역 요청
      if (request.action === "translatePage") {
        translatePage().then(result => {
          sendResponse({ success: true, result });
        }).catch(error => {
          console.error("[번역 익스텐션] 오류:", error);
          sendResponse({ success: false, error: error.message });
        });
        return true; // 비동기 응답을 위해 true 반환
      }
      
      // 설정 업데이트
      if (request.action === "updateSettings") {
        loadSettings().then(() => {
          sendResponse({ success: true });
        });
        return true;
      }
    });
    
    // 번역 한도 초과 이벤트 리스너 등록
    window.addEventListener('translation:limit-exceeded', () => {
      DOMHandler.showTranslationLimitExceeded(() => {
        chrome.runtime.sendMessage({ action: "openPopup" });
      });
    });
  }
  
  /**
   * 페이지 로드 완료 시 자동 번역 설정
   */
  function setupAutoTranslate() {
    document.addEventListener('DOMContentLoaded', () => {
      // 설정 로드
      loadSettings().then(settings => {
        if (settings.autoTranslate) {
          translatePage();
        }
      });
      
      // 주기적으로 오래된 캐시 정리
      setTimeout(() => CacheManager.cleanupExpired(), 10000);
    });
  }
  
  /**
   * 초기화 및 라이프사이클 관리
   */
  function init() {
    // 메시지 리스너 설정
    setupMessageListeners();
    
    // 자동 번역 설정
    setupAutoTranslate();
    
    // 필요한 기능을 전역으로 노출 (선택 사항)
    window.tonyTranslator = {
      translatePage,
      translateVisibleContent,
      getSettings: () => AppState.settings
    };
    
    console.log("[번역 익스텐션] 초기화 완료");
  }
  
  // 애플리케이션 초기화
  init();
  
})();