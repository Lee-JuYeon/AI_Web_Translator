// dom-manipulator.js - DOM 요소 조작 및 번역 결과 적용 모듈

const DOMManipulator = (function() {
    'use strict';
    
    // 내부 설정 (기본값)
    const DEFAULT_SETTINGS = {
      translatedAttr: 'data-tony-translated', // 번역 완료된 요소 속성
      pendingAttr: 'data-tony-pending',       // 번역 대기 중인 요소 속성
      sourceAttr: 'data-tony-source',         // 원본 텍스트 저장 속성
      translationClass: 'tony-translated',    // 번역된 요소에 추가할 클래스
      animateChanges: true,                   // 변경 사항 애니메이션 효과 적용 여부
      keepOriginalOnHover: true,              // 마우스 오버 시 원본 텍스트 표시 여부
      highlightTranslated: false,             // 번역된 텍스트 강조 표시 여부
      preserveFormatting: true,               // 서식 보존 여부
      safeMode: true                          // 안전 모드 (오류 발생 시 원본 유지)
    };
    
    // 현재 설정
    let settings = {...DEFAULT_SETTINGS};
    
    // 내부 상태
    const state = {
      translationCount: 0,       // 번역된 텍스트 수
      failedCount: 0,            // 실패한 번역 수
      styleInjected: false,      // 스타일 주입 여부
      debugMode: false,          // 디버그 모드 여부
      lastError: null            // 마지막 오류
    };
    
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
        console.error(`[번역 익스텐션] 이벤트 발행 오류 (${eventName}):`, error);
        return false;
      }
    }
    
    /**
     * 요소에 번역 관련 스타일 주입
     * @private
     */
    function injectStyles() {
      // 이미 주입된 경우 중복 방지
      if (state.styleInjected) return;
      
      try {
        const styleElement = document.createElement('style');
        styleElement.id = 'tony-translator-styles';
        styleElement.textContent = `
          .${settings.translationClass} {
            transition: background-color 0.3s ease;
          }
          
          ${settings.highlightTranslated ? `.${settings.translationClass} {
            background-color: rgba(255, 255, 0, 0.15);
          }` : ''}
          
          ${settings.animateChanges ? `.tony-translating {
            animation: tony-fade-in 0.5s ease;
          }
          
          @keyframes tony-fade-in {
            from { opacity: 0.7; }
            to { opacity: 1; }
          }` : ''}
          
          ${settings.keepOriginalOnHover ? `[${settings.translatedAttr}][${settings.sourceAttr}]:hover::after {
            content: attr(${settings.sourceAttr});
            position: absolute;
            top: 100%;
            left: 0;
            background: white;
            color: #333;
            border: 1px solid #ccc;
            padding: 4px 8px;
            font-size: 12px;
            z-index: 9999;
            max-width: 300px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            border-radius: 4px;
            opacity: 0.9;
            pointer-events: none;
          }
          
          [${settings.translatedAttr}][${settings.sourceAttr}] {
            position: relative;
          }` : ''}
          
          /* 디버그 모드 스타일 */
          ${state.debugMode ? `
          [${settings.translatedAttr}] {
            outline: 1px solid rgba(0, 255, 0, 0.3);
          }
          
          [${settings.pendingAttr}] {
            outline: 1px solid rgba(255, 165, 0, 0.3);
          }
          
          .tony-error {
            outline: 1px solid rgba(255, 0, 0, 0.3) !important;
          }` : ''}
        `;
        
        document.head.appendChild(styleElement);
        state.styleInjected = true;
        
        console.log("[번역 익스텐션] 번역 스타일 주입 완료");
      } catch (error) {
        console.error("[번역 익스텐션] 스타일 주입 오류:", error);
      }
    }
    
    /**
     * 텍스트 노드 내용 교체
     * @param {Node} node - 텍스트 노드
     * @param {string} newText - 새 텍스트
     * @returns {boolean} - 교체 성공 여부
     */
    function replaceTextNodeContent(node, newText) {
      try {
        if (!node || node.nodeType !== Node.TEXT_NODE) {
          return false;
        }
        
        const originalText = node.textContent;
        
        // 이미 같은 텍스트인 경우 무시
        if (originalText === newText) {
          return false;
        }
        
        // 부모 요소에 원본 텍스트 저장
        if (settings.keepOriginalOnHover && node.parentElement) {
          node.parentElement.setAttribute(settings.sourceAttr, originalText);
        }
        
        // 텍스트 내용 교체
        node.textContent = newText;
        
        // 부모 요소에 번역 완료 표시
        if (node.parentElement) {
          node.parentElement.setAttribute(settings.translatedAttr, 'true');
          
          if (node.parentElement.hasAttribute(settings.pendingAttr)) {
            node.parentElement.removeAttribute(settings.pendingAttr);
          }
          
          // 번역된 클래스 추가
          if (settings.translationClass) {
            node.parentElement.classList.add(settings.translationClass);
          }
          
          // 애니메이션 효과 적용
          if (settings.animateChanges) {
            node.parentElement.classList.add('tony-translating');
            setTimeout(() => {
              node.parentElement.classList.remove('tony-translating');
            }, 500);
          }
        }
        
        return true;
      } catch (error) {
        console.error("[번역 익스텐션] 텍스트 노드 내용 교체 오류:", error);
        state.lastError = error;
        state.failedCount++;
        
        // 디버그 모드에서 오류 표시
        if (state.debugMode && node.parentElement) {
          node.parentElement.classList.add('tony-error');
        }
        
        // 안전 모드에서 원본 텍스트 복원
        if (settings.safeMode && node.parentElement) {
          try {
            node.textContent = originalText;
          } catch (e) {
            // 복원 오류는 무시
          }
        }
        
        return false;
      }
    }
    
    /**
     * 요소 속성 텍스트 교체
     * @param {Element} element - 요소
     * @param {string} attributeName - 속성 이름
     * @param {string} newText - 새 텍스트
     * @returns {boolean} - 교체 성공 여부
     */
    function replaceElementAttribute(element, attributeName, newText) {
      try {
        if (!element || !attributeName || !element.hasAttribute(attributeName)) {
          return false;
        }
        
        const originalText = element.getAttribute(attributeName);
        
        // 이미 같은 텍스트인 경우 무시
        if (originalText === newText) {
          return false;
        }
        
        // 원본 속성 값 저장
        if (settings.keepOriginalOnHover) {
          element.setAttribute(`${settings.sourceAttr}-${attributeName}`, originalText);
        }
        
        // 속성 값 교체
        element.setAttribute(attributeName, newText);
        
        // 번역 완료 표시
        element.setAttribute(settings.translatedAttr, 'true');
        
        if (element.hasAttribute(settings.pendingAttr)) {
          element.removeAttribute(settings.pendingAttr);
        }
        
        // 번역된 클래스 추가
        if (settings.translationClass) {
          element.classList.add(settings.translationClass);
        }
        
        // 애니메이션 효과 적용
        if (settings.animateChanges) {
          element.classList.add('tony-translating');
          setTimeout(() => {
            element.classList.remove('tony-translating');
          }, 500);
        }
        
        return true;
      } catch (error) {
        console.error(`[번역 익스텐션] 요소 속성(${attributeName}) 교체 오류:`, error);
        state.lastError = error;
        state.failedCount++;
        
        // 디버그 모드에서 오류 표시
        if (state.debugMode) {
          element.classList.add('tony-error');
        }
        
        // 안전 모드에서 원본 값 복원
        if (settings.safeMode) {
          try {
            element.setAttribute(attributeName, originalText);
          } catch (e) {
            // 복원 오류는 무시
          }
        }
        
        return false;
      }
    }
    
    /**
     * XPath 방식 없이 요소 내용 변경
     * @param {Element} element - 대상 요소
     * @param {string} newText - 새 텍스트
     * @returns {boolean} - 교체 성공 여부
     */
    function replaceElementText(element, newText) {
      try {
        if (!element || !(element instanceof Element)) {
          return false;
        }
        
        // 현재 텍스트 내용 가져오기
        const originalText = element.textContent;
        
        // 이미 같은 텍스트인 경우 무시
        if (originalText === newText) {
          return false;
        }
        
        // 원본 텍스트 저장
        if (settings.keepOriginalOnHover) {
          element.setAttribute(settings.sourceAttr, originalText);
        }
        
        // 서식 보존 처리
        if (settings.preserveFormatting && element.childNodes.length > 0) {
          // 텍스트 노드만 변경하는 방식으로 처리
          let textNodesChanged = 0;
          
          // 각 텍스트 노드 처리
          element.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
              // 간단한 휴리스틱: 텍스트 노드가 하나만 있으면 전체를 교체
              if (element.childNodes.length === 1) {
                node.textContent = newText;
                textNodesChanged++;
              }
              // 여러 텍스트 노드가 있는 경우 부분 교체는 복잡하므로 여기서는 처리 안함
            }
          });
          
          // 텍스트 노드 교체가 없었다면 모든 내용 변경
          if (textNodesChanged === 0) {
            element.textContent = newText;
          }
        } else {
          // 간단하게 전체 내용 교체
          element.textContent = newText;
        }
        
        // 번역 완료 표시
        element.setAttribute(settings.translatedAttr, 'true');
        
        if (element.hasAttribute(settings.pendingAttr)) {
          element.removeAttribute(settings.pendingAttr);
        }
        
        // 번역된 클래스 추가
        if (settings.translationClass) {
          element.classList.add(settings.translationClass);
        }
        
        // 애니메이션 효과 적용
        if (settings.animateChanges) {
          element.classList.add('tony-translating');
          setTimeout(() => {
            element.classList.remove('tony-translating');
          }, 500);
        }
        
        return true;
      } catch (error) {
        console.error("[번역 익스텐션] 요소 텍스트 교체 오류:", error);
        state.lastError = error;
        state.failedCount++;
        
        // 디버그 모드에서 오류 표시
        if (state.debugMode) {
          element.classList.add('tony-error');
        }
        
        // 안전 모드에서 원본 텍스트 복원
        if (settings.safeMode) {
          try {
            element.textContent = originalText;
          } catch (e) {
            // 복원 오류는 무시
          }
        }
        
        return false;
      }
    }
    
    /**
     * 번역 결과를 DOM에 적용
     * @param {Array} translatedItems - [{original, translated, element, type, attribute}] 형태의 번역 항목
     * @returns {number} - 적용된 번역 수
     */
    function applyTranslations(translatedItems) {
      if (!Array.isArray(translatedItems) || translatedItems.length === 0) {
        return 0;
      }
      
      // 스타일 주입
      injectStyles();
      
      // 결과 카운터
      let successCount = 0;
      
      // 각 번역 항목 처리
      translatedItems.forEach(item => {
        try {
          if (!item || !item.translated || item.original === item.translated) {
            return;
          }
          
          // 요소가 없는 경우 무시
          if (!item.element || !(item.element instanceof Element)) {
            return;
          }
          
          let success = false;
          
          // 번역 타입에 따라 다르게 처리
          if (item.type === 'attribute' && item.attribute) {
            // 속성 번역
            success = replaceElementAttribute(item.element, item.attribute, item.translated);
          } else if (item.type === 'text' && item.node && item.node.nodeType === Node.TEXT_NODE) {
            // 텍스트 노드 번역
            success = replaceTextNodeContent(item.node, item.translated);
          } else {
            // 요소 텍스트 직접 번역
            success = replaceElementText(item.element, item.translated);
          }
          
          if (success) {
            successCount++;
          }
        } catch (itemError) {
          console.warn("[번역 익스텐션] 번역 항목 적용 오류:", itemError);
          state.failedCount++;
        }
      });
      
      // 번역 개수 업데이트
      state.translationCount += successCount;
      
      // 이벤트 발생
      safeDispatchEvent('dom:text-replaced', { 
        count: successCount,
        total: translatedItems.length,
        failed: translatedItems.length - successCount
      });
      
      console.log(`[번역 익스텐션] ${successCount}개 번역 적용 완료 (${translatedItems.length - successCount}개 실패)`);
      
      return successCount;
    }
    
    /**
     * 요소 배열에 번역 완료 표시
     * @param {Element[]} elements - 요소 배열
     */
    function markElementsAsTranslated(elements) {
      if (!Array.isArray(elements) || elements.length === 0) {
        return;
      }
      
      elements.forEach(element => {
        try {
          if (element && element instanceof Element) {
            // 번역 대기 중 속성 제거
            if (element.hasAttribute(settings.pendingAttr)) {
              element.removeAttribute(settings.pendingAttr);
            }
            
            // 번역 완료 속성 추가
            element.setAttribute(settings.translatedAttr, 'true');
            
            // 번역된 클래스 추가
            if (settings.translationClass) {
              element.classList.add(settings.translationClass);
            }
          }
        } catch (elementError) {
          console.warn("[번역 익스텐션] 요소 상태 업데이트 오류:", elementError);
        }
      });
    }
    
    /**
     * 디버그 모드 설정
     * @param {boolean} enabled - 활성화 여부
     */
    function setDebugMode(enabled) {
      state.debugMode = !!enabled;
      
      // 스타일 업데이트
      if (state.styleInjected) {
        // 기존 스타일 요소 제거
        const oldStyle = document.getElementById('tony-translator-styles');
        if (oldStyle) {
          oldStyle.remove();
        }
        
        // 초기화 후 다시 주입
        state.styleInjected = false;
        injectStyles();
      }
      
      console.log(`[번역 익스텐션] 디버그 모드 ${state.debugMode ? '활성화' : '비활성화'}`);
    }
    
    /**
     * 번역 요소 리셋
     * @param {Element[]} elements - 요소 배열 (없으면 모든 번역 요소)
     */
    function resetTranslatedElements(elements) {
      try {
        const targetElements = elements || 
          document.querySelectorAll(`[${settings.translatedAttr}]`);
        
        let count = 0;
        
        targetElements.forEach(element => {
          try {
            if (element && element instanceof Element) {
              // 원본 텍스트 복원
              if (element.hasAttribute(settings.sourceAttr)) {
                const originalText = element.getAttribute(settings.sourceAttr);
                element.textContent = originalText;
                element.removeAttribute(settings.sourceAttr);
                count++;
              }
              
              // 속성 복원
              Array.from(element.attributes)
                .filter(attr => attr.name.startsWith(`${settings.sourceAttr}-`))
                .forEach(attr => {
                  const attrName = attr.name.replace(`${settings.sourceAttr}-`, '');
                  const originalValue = attr.value;
                  element.setAttribute(attrName, originalValue);
                  element.removeAttribute(attr.name);
                  count++;
                });
              
              // 번역 관련 속성 및 클래스 제거
              element.removeAttribute(settings.translatedAttr);
              
              if (element.hasAttribute(settings.pendingAttr)) {
                element.removeAttribute(settings.pendingAttr);
              }
              
              if (settings.translationClass) {
                element.classList.remove(settings.translationClass);
              }
              
              element.classList.remove('tony-translating', 'tony-error');
            }
          } catch (elementError) {
            console.warn("[번역 익스텐션] 요소 리셋 오류:", elementError);
          }
        });
        
        console.log(`[번역 익스텐션] ${count}개 번역 요소 리셋 완료`);
        
        return count;
      } catch (error) {
        console.error("[번역 익스텐션] 번역 요소 리셋 오류:", error);
        return 0;
      }
    }
    
    /**
     * 번역 현황 통계 가져오기
     * @returns {Object} - 번역 통계
     */
    function getStatistics() {
      return {
        translationCount: state.translationCount,
        failedCount: state.failedCount,
        translatedElements: document.querySelectorAll(`[${settings.translatedAttr}]`).length,
        pendingElements: document.querySelectorAll(`[${settings.pendingAttr}]`).length,
        debugMode: state.debugMode,
        styleInjected: state.styleInjected
      };
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
        
        // 스타일 관련 설정이 변경된 경우 스타일 다시 주입
        if (oldSettings.translationClass !== settings.translationClass ||
            oldSettings.animateChanges !== settings.animateChanges ||
            oldSettings.keepOriginalOnHover !== settings.keepOriginalOnHover ||
            oldSettings.highlightTranslated !== settings.highlightTranslated) {
            
          // 기존 스타일 초기화
          state.styleInjected = false;
          
          // 스타일 요소 제거
          const styleElement = document.getElementById('tony-translator-styles');
          if (styleElement) {
            styleElement.remove();
          }
          
          // 새 스타일 주입
          injectStyles();
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
      applyTranslations,
      markElementsAsTranslated,
      setDebugMode,
      resetTranslatedElements,
      getStatistics,
      updateSettings,
      getSettings,
      injectStyles
    };
  })();
  
  // 모듈 내보내기
  window.DOMManipulator = DOMManipulator;