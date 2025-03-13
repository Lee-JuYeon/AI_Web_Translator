// dom-observer.js - DOM 변화 관찰 및 IntersectionObserver 관리 모듈

const DOMObserver = (function() {
    'use strict';
    
    // 내부 설정 (기본값)
    const DEFAULT_SETTINGS = {
      rootMargin: '200px',     // IntersectionObserver의 루트 마진
      translatedAttr: 'data-tony-translated', // 번역 완료된 요소 속성
      pendingAttr: 'data-tony-pending',       // 번역 대기 중인 요소 속성
      observeAllOnInit: true,  // 초기화 시 모든 요소 관찰 여부
      preloadThreshold: 0.1    // 요소가 보이는 기준 임계값 (10%)
    };
    
    // 현재 설정
    let settings = {...DEFAULT_SETTINGS};
    
    // 상태 관리
    const state = {
      intersectionObserver: null,    // IntersectionObserver 인스턴스
      mutationObserver: null,        // MutationObserver 인스턴스
      observedElements: new WeakSet(), // 이미 관찰 중인 요소 추적
      isInitialized: false,          // 초기화 상태
      isTranslating: false,          // 번역 중 상태
      isEnabled: true                // 관찰 활성화 상태
    };
    
    /**
     * 안전한 이벤트 발행 함수
     * @param {string} eventName - 이벤트 이름
     * @param {Object} detail - 이벤트 detail 객체
     * @returns {boolean} - 이벤트 발행 성공 여부
     */
    function safeDispatchEvent(eventName, detail = {}) {
      try {
        if (!state.isEnabled) {
          return false;
        }
        
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
    
    /**
     * IntersectionObserver 초기화
     * @private
     */
    function initIntersectionObserver() {
      // 이미 초기화되었다면 중복 생성 방지
      if (state.intersectionObserver) return;
      
      try {
        state.intersectionObserver = new IntersectionObserver(
          handleIntersection, 
          { 
            rootMargin: settings.rootMargin, 
            threshold: settings.preloadThreshold
          }
        );
        
        console.log("[번역 익스텐션] IntersectionObserver 초기화됨");
      } catch (error) {
        console.error("[번역 익스텐션] IntersectionObserver 초기화 오류:", error);
      }
    }
    
    /**
     * MutationObserver 초기화
     * @private
     */
    function initMutationObserver() {
      // 이미 초기화되었다면 중복 생성 방지
      if (state.mutationObserver) return;
      
      try {
        state.mutationObserver = new MutationObserver(handleMutation);
        
        // document.body 관찰 시작
        if (document.body) {
          state.mutationObserver.observe(document.body, {
            childList: true,  // 자식 노드 추가/제거 감지
            subtree: true     // 모든 하위 트리 변경 감지
          });
          
          console.log("[번역 익스텐션] MutationObserver 초기화됨");
        } else {
          console.warn("[번역 익스텐션] document.body가 준비되지 않았습니다.");
        }
      } catch (error) {
        console.error("[번역 익스텐션] MutationObserver 초기화 오류:", error);
      }
    }
    
    /**
     * IntersectionObserver 콜백 핸들러
     * @private
     * @param {IntersectionObserverEntry[]} entries - 교차 변경된 요소들
     */
    function handleIntersection(entries) {
      try {
        // 번역 중이거나 비활성화 상태면 무시
        if (state.isTranslating || !state.isEnabled) return;
        
        // 화면에 보이는 요소만 필터링
        const visibleEntries = entries.filter(entry => entry.isIntersecting);
        
        if (visibleEntries.length === 0) return;
        
        console.log(`[번역 익스텐션] ${visibleEntries.length}개 요소가 화면에 보임`);
        
        // 번역 대상 요소들
        const elementsToProcess = visibleEntries.map(entry => entry.target).filter(Boolean);
        
        // 화면에 보이는 요소들 처리 이벤트 발생
        if (elementsToProcess.length > 0) {
          // 번역 대기 중으로 표시
          elementsToProcess.forEach(element => {
            if (element && !element.hasAttribute(settings.translatedAttr)) {
              element.setAttribute(settings.pendingAttr, 'true');
            }
          });
          
          // 이벤트 발생
          safeDispatchEvent('dom:elements-visible', { 
            elements: elementsToProcess 
          });
        }
      } catch (error) {
        console.error("[번역 익스텐션] Intersection 처리 오류:", error);
      }
    }
    
    /**
     * MutationObserver 콜백 핸들러
     * @private
     * @param {MutationRecord[]} mutations - 감지된 DOM 변경 사항
     */
    function handleMutation(mutations) {
      try {
        // 번역 중이거나 비활성화 상태면 무시
        if (state.isTranslating || !state.isEnabled) return;
        
        // 중요한 변경사항이 있는지 먼저 확인
        let hasSignificantChanges = false;
        
        for (const mutation of mutations) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            // 실제 요소 노드가 추가되었는지 확인
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                hasSignificantChanges = true;
                break;
              }
            }
            
            if (hasSignificantChanges) break;
          }
        }
        
        // 중요한 변경사항이 없으면 건너뜀
        if (!hasSignificantChanges) return;
        
        console.log("[번역 익스텐션] DOM 변경 감지됨, 새 텍스트 컨테이너 검색");
        
        // 새로 추가된 요소 찾기
        const newElements = [];
        mutations.forEach(mutation => {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                newElements.push(node);
              }
            });
          }
        });
        
        // 이벤트 발생
        if (newElements.length > 0) {
          safeDispatchEvent('dom:elements-added', { 
            elements: newElements 
          });
        }
      } catch (error) {
        console.error("[번역 익스텐션] Mutation 처리 오류:", error);
      }
    }
    
    /**
     * 요소를 IntersectionObserver에 등록
     * @param {Element} element - 관찰할 요소
     */
    function observeElement(element) {
      try {
        if (!element || !(element instanceof Element)) {
          return;
        }
        
        // 이미 번역된 요소는 건너뜀
        if (element.hasAttribute(settings.translatedAttr)) {
          return;
        }
        
        // IntersectionObserver가 없으면 초기화
        if (!state.intersectionObserver) {
          initIntersectionObserver();
          if (!state.intersectionObserver) {
            console.error("[번역 익스텐션] IntersectionObserver 초기화 실패");
            return;
          }
        }
        
        // 이미 관찰 중인 요소는 건너뜀
        if (state.observedElements.has(element)) {
          return;
        }
        
        // 번역 대기 중으로 표시
        element.setAttribute(settings.pendingAttr, 'true');
        
        // IntersectionObserver에 등록
        state.intersectionObserver.observe(element);
        
        // 관찰 중인 요소로 추가
        state.observedElements.add(element);
      } catch (error) {
        console.error("[번역 익스텐션] 요소 관찰 등록 오류:", error);
      }
    }
    
    /**
     * 요소 배열을 IntersectionObserver에 등록
     * @param {Element[]} elements - 관찰할 요소 배열
     */
    function observeElements(elements) {
      try {
        if (!Array.isArray(elements) || elements.length === 0) {
          return;
        }
        
        elements.forEach(element => {
          observeElement(element);
        });
        
        console.log(`[번역 익스텐션] ${elements.length}개 요소 관찰 등록`);
      } catch (error) {
        console.error("[번역 익스텐션] 요소들 관찰 등록 오류:", error);
      }
    }
    
    /**
     * 번역 상태 설정
     * @param {boolean} isTranslating - 번역 중 상태
     */
    function setTranslatingState(isTranslating) {
      try {
        state.isTranslating = !!isTranslating; // 불리언 타입 강제
        
        // 상태 변경 이벤트 발행
        safeDispatchEvent('dom:translating-state-changed', { 
          isTranslating: state.isTranslating 
        });
      } catch (error) {
        console.error('[번역 익스텐션] 번역 상태 설정 오류:', error);
      }
    }
    
    /**
     * 번역 상태 가져오기
     * @returns {boolean} - 번역 중 상태
     */
    function getTranslatingState() {
      return state.isTranslating;
    }
    
    /**
     * 관찰자 활성화/비활성화 설정
     * @param {boolean} isEnabled - 활성화 여부
     */
    function setEnabled(isEnabled) {
      state.isEnabled = !!isEnabled; // 불리언 타입 강제
      console.log(`[번역 익스텐션] DOM 관찰자 ${state.isEnabled ? '활성화' : '비활성화'}`);
    }
    
    /**
     * 관찰자 초기화
     * @returns {boolean} - 초기화 성공 여부
     */
    function initialize() {
      try {
        // 이미 초기화된 경우
        if (state.isInitialized) {
          return true;
        }
        
        // 관찰자 초기화
        initIntersectionObserver();
        initMutationObserver();
        
        // 초기화 상태 설정
        state.isInitialized = true;
        state.isEnabled = true;
        
        // 초기화 완료 이벤트 발행
        safeDispatchEvent('dom:observer-initialized', { success: true });
        
        console.log("[번역 익스텐션] DOM 관찰자 초기화 완료");
        return true;
      } catch (error) {
        console.error("[번역 익스텐션] DOM 관찰자 초기화 오류:", error);
        return false;
      }
    }
    
    /**
     * 화면에 현재 보이는 모든 요소 처리
     * 즉시 번역을 위해 현재 화면에 보이는 요소들을 가져옴
     */
    function processVisibleElements() {
      try {
        // DOMSelector 모듈이 필요함
        if (!window.DOMSelector) {
          console.error("[번역 익스텐션] DOMSelector 모듈이 필요합니다.");
          return [];
        }
        
        // 텍스트 컨테이너 요소들 찾기
        const containers = window.DOMSelector.findTextContainers(document.body);
        const visibleElements = [];
        
        // 화면에 보이는 요소 필터링
        containers.forEach(element => {
          try {
            if (isElementVisible(element)) {
              visibleElements.push(element);
              
              // 번역 대기 중으로 표시
              if (!element.hasAttribute(settings.translatedAttr)) {
                element.setAttribute(settings.pendingAttr, 'true');
              }
            } else {
              // 화면에 보이지 않는 요소는 관찰자에 등록
              observeElement(element);
            }
          } catch (elementError) {
            console.warn("[번역 익스텐션] 요소 가시성 확인 오류:", elementError);
          }
        });
        
        console.log(`[번역 익스텐션] 현재 화면에 보이는 ${visibleElements.length}개 요소 처리`);
        
        // 화면에 보이는 요소 처리 이벤트 발행
        if (visibleElements.length > 0) {
          safeDispatchEvent('dom:elements-visible', { 
            elements: visibleElements 
          });
        }
        
        return visibleElements;
      } catch (error) {
        console.error("[번역 익스텐션] 화면에 보이는 요소 처리 오류:", error);
        return [];
      }
    }
    
    /**
     * 요소가 화면에 보이는지 확인
     * @param {Element} element - 확인할 요소
     * @returns {boolean} - 화면에 보이는지 여부
     */
    function isElementVisible(element) {
      try {
        if (!element || !(element instanceof Element)) {
          return false;
        }
        
        const rect = element.getBoundingClientRect();
        
        // 화면 크기
        const viewHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
        const viewWidth = Math.max(document.documentElement.clientWidth, window.innerWidth);
        
        // 화면 밖에 있는지 확인
        if (rect.bottom < 0 || rect.top > viewHeight || 
            rect.right < 0 || rect.left > viewWidth) {
          return false;
        }
        
        // 요소의 스타일 확인
        const style = window.getComputedStyle(element);
        
        // 화면에 표시되지 않는 경우
        if (style.display === 'none' || style.visibility === 'hidden' || 
            style.opacity === '0' || element.offsetParent === null) {
          return false;
        }
        
        return true;
      } catch (error) {
        console.error("[번역 익스텐션] 요소 가시성 확인 오류:", error);
        return false;
      }
    }
    
    /**
     * 관찰자 정리 및 초기화
     */
    function cleanup() {
      try {
        // IntersectionObserver 정리
        if (state.intersectionObserver) {
          try {
            state.intersectionObserver.disconnect();
          } catch (observerError) {
            console.warn('[번역 익스텐션] IntersectionObserver 해제 오류:', observerError);
          }
          state.intersectionObserver = null;
        }
        
        // MutationObserver 정리
        if (state.mutationObserver) {
          try {
            state.mutationObserver.disconnect();
          } catch (observerError) {
            console.warn('[번역 익스텐션] MutationObserver 해제 오류:', observerError);
          }
          state.mutationObserver = null;
        }
        
        // 상태 초기화
        state.observedElements = new WeakSet();
        state.isInitialized = false;
        state.isTranslating = false;
        
        console.log('[번역 익스텐션] DOM 관찰자 정리 완료');
      } catch (error) {
        console.error('[번역 익스텐션] DOM 관찰자 정리 오류:', error);
      }
    }
    
    /**
     * 설정 업데이트
     * @param {Object} newSettings - 새 설정 값
     */
    function updateSettings(newSettings) {
      try {
        if (!newSettings) return;
        
        const oldSettings = { ...settings };
        settings = { ...settings, ...newSettings };
        
        // rootMargin이 변경된 경우 IntersectionObserver 재초기화
        if (oldSettings.rootMargin !== settings.rootMargin ||
            oldSettings.preloadThreshold !== settings.preloadThreshold) {
          
          // 기존 관찰자 해제
          if (state.intersectionObserver) {
            try {
              state.intersectionObserver.disconnect();
            } catch (observerError) {
              console.warn('[번역 익스텐션] IntersectionObserver 해제 오류:', observerError);
            }
            state.intersectionObserver = null;
          }
          
          // 새 설정으로 다시 초기화
          initIntersectionObserver();
        }
      } catch (error) {
        console.error('[번역 익스텐션] 설정 업데이트 오류:', error);
      }
    }
    
    /**
     * 현재 설정 가져오기
     * @returns {Object} - 현재 설정
     */
    function getSettings() {
      return { ...settings };
    }
    
    // 공개 API
    return {
      initialize,
      observeElement,
      observeElements,
      setTranslatingState,
      getTranslatingState,
      setEnabled,
      processVisibleElements,
      isElementVisible,
      cleanup,
      updateSettings,
      getSettings,
      safeDispatchEvent
    };
  })();
  
  // 모듈 내보내기
  window.DOMObserver = DOMObserver;