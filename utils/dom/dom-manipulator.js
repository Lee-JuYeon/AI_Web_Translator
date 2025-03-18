// dom-manipulator.js - ES 모듈 방식으로 리팩토링
import { APP_CONFIG, safeDispatchEvent } from '../../config.js';

// 기본 설정
const DEFAULT_SETTINGS = {
  translatedAttr: APP_CONFIG.domAttributes.translatedAttr,
  pendingAttr: APP_CONFIG.domAttributes.pendingAttr,
  sourceAttr: APP_CONFIG.domAttributes.sourceAttr,
  translationClass: APP_CONFIG.domAttributes.translationClass || 'tony-translated',
  animateChanges: true,
  keepOriginalOnHover: true,
  highlightTranslated: false,
  preserveFormatting: true,
  safeMode: true
};

// 현재 설정
let settings = {...DEFAULT_SETTINGS};

// 내부 상태
const state = {
  translationCount: 0,
  failedCount: 0,
  styleInjected: false,
  debugMode: false,
  lastError: null
};

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
    styleElement.textContent = generateStylesContent();
    
    document.head.appendChild(styleElement);
    state.styleInjected = true;
    
    console.log(`[${APP_CONFIG.appName}] 번역 스타일 주입 완료`);
  } catch (error) {
    handleError('스타일 주입 오류', error);
  }
}

/**
 * 스타일 내용 생성
 * @returns {string} - CSS 스타일 내용
 */
function generateStylesContent() {
  const styleContent = [
    // 기본 번역 클래스 스타일
    `.${settings.translationClass} {
      transition: background-color 0.3s ease;
    }`,
    
    // 번역 요소 강조 (설정에 따라)
    settings.highlightTranslated ? 
    `.${settings.translationClass} {
      background-color: rgba(255, 255, 0, 0.15);
    }` : '',
    
    // 애니메이션 효과 (설정에 따라)
    settings.animateChanges ? 
    `.tony-translating {
      animation: tony-fade-in 0.5s ease;
    }
    
    @keyframes tony-fade-in {
      from { opacity: 0.7; }
      to { opacity: 1; }
    }` : '',
    
    // 원본 텍스트 호버 표시 (설정에 따라)
    settings.keepOriginalOnHover ? 
    `[${settings.translatedAttr}][${settings.sourceAttr}]:hover::after {
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
    }` : '',
    
    // 디버그 모드 스타일
    state.debugMode ? 
    `[${settings.translatedAttr}] {
      outline: 1px solid rgba(0, 255, 0, 0.3);
    }
    
    [${settings.pendingAttr}] {
      outline: 1px solid rgba(255, 165, 0, 0.3);
    }
    
    .tony-error {
      outline: 1px solid rgba(255, 0, 0, 0.3) !important;
    }` : ''
  ];
  
  return styleContent.join('\n');
}

/**
 * 텍스트 노드 내용 교체
 * @param {Node} node - 텍스트 노드
 * @param {string} newText - 새 텍스트
 * @returns {boolean} - 교체 성공 여부
 */
function replaceTextNodeContent(node, newText) {
  let originalText = '';
  
  try {
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return false;
    }
    
    originalText = node.textContent;
    
    // 이미 같은 텍스트인 경우 무시
    if (originalText === newText) {
      return false;
    }
    
    // 부모 요소에 원본 텍스트 저장 (설정에 따라)
    if (settings.keepOriginalOnHover && node.parentElement) {
      node.parentElement.setAttribute(settings.sourceAttr, originalText);
    }
    
    // 텍스트 내용 교체
    node.textContent = newText;
    
    // 부모 요소 상태 업데이트
    if (node.parentElement) {
      updateElementAfterTranslation(node.parentElement);
    }
    
    return true;
  } catch (error) {
    return handleTextNodeError(error, node, originalText);
  }
}

/**
 * 요소 번역 후 상태 업데이트
 * @param {Element} element - 업데이트할 요소
 */
function updateElementAfterTranslation(element) {
  // 번역 완료 표시
  element.setAttribute(settings.translatedAttr, 'true');
  
  // 대기 상태 제거
  if (element.hasAttribute(settings.pendingAttr)) {
    element.removeAttribute(settings.pendingAttr);
  }
  
  // 번역된 클래스 추가
  if (settings.translationClass) {
    element.classList.add(settings.translationClass);
  }
  
  // 애니메이션 효과 적용 (설정에 따라)
  if (settings.animateChanges) {
    applyTranslationAnimation(element);
  }
}

/**
 * 번역 애니메이션 적용
 * @param {Element} element - 애니메이션을 적용할 요소
 */
function applyTranslationAnimation(element) {
  element.classList.add('tony-translating');
  setTimeout(() => {
    element.classList.remove('tony-translating');
  }, 500);
}

/**
 * 텍스트 노드 오류 처리
 * @param {Error} error - 발생한 오류
 * @param {Node} node - 텍스트 노드
 * @param {string} originalText - 원본 텍스트
 * @returns {boolean} - 항상 false 반환 (오류 발생)
 */
function handleTextNodeError(error, node, originalText) {
  console.error(`[${APP_CONFIG.appName}] 텍스트 노드 내용 교체 오류:`, error);
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

/**
 * 요소 속성 텍스트 교체
 * @param {Element} element - 요소
 * @param {string} attributeName - 속성 이름
 * @param {string} newText - 새 텍스트
 * @returns {boolean} - 교체 성공 여부
 */
function replaceElementAttribute(element, attributeName, newText) {
  let originalText = '';
  
  try {
    if (!element || !attributeName || !element.hasAttribute(attributeName)) {
      return false;
    }
    
    originalText = element.getAttribute(attributeName);
    
    // 이미 같은 텍스트인 경우 무시
    if (originalText === newText) {
      return false;
    }
    
    // 원본 속성 값 저장 (설정에 따라)
    if (settings.keepOriginalOnHover) {
      element.setAttribute(`${settings.sourceAttr}-${attributeName}`, originalText);
    }
    
    // 속성 값 교체
    element.setAttribute(attributeName, newText);
    
    // 요소 상태 업데이트
    updateElementAfterTranslation(element);
    
    return true;
  } catch (error) {
    return handleAttributeError(error, element, attributeName, originalText);
  }
}

/**
 * 속성 오류 처리
 * @param {Error} error - 발생한 오류
 * @param {Element} element - 대상 요소
 * @param {string} attributeName - 속성 이름
 * @param {string} originalText - 원본 텍스트
 * @returns {boolean} - 항상 false 반환 (오류 발생)
 */
function handleAttributeError(error, element, attributeName, originalText) {
  console.error(`[${APP_CONFIG.appName}] 요소 속성(${attributeName}) 교체 오류:`, error);
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

/**
 * XPath 방식 없이 요소 내용 변경
 * @param {Element} element - 대상 요소
 * @param {string} newText - 새 텍스트
 * @returns {boolean} - 교체 성공 여부
 */
function replaceElementText(element, newText) {
  let originalText = '';
  
  try {
    if (!element || !(element instanceof Element)) {
      return false;
    }
    
    // 현재 텍스트 내용 가져오기
    originalText = element.textContent;
    
    // 이미 같은 텍스트인 경우 무시
    if (originalText === newText) {
      return false;
    }
    
    // 원본 텍스트 저장 (설정에 따라)
    if (settings.keepOriginalOnHover) {
      element.setAttribute(settings.sourceAttr, originalText);
    }
    
    // 서식 보존 처리에 따른 내용 변경
    changeElementContent(element, newText);
    
    // 요소 상태 업데이트
    updateElementAfterTranslation(element);
    
    return true;
  } catch (error) {
    return handleElementTextError(error, element, originalText);
  }
}

/**
 * 요소 내용 변경 (서식 보존 설정에 따라)
 * @param {Element} element - 대상 요소
 * @param {string} newText - 새 텍스트
 */
function changeElementContent(element, newText) {
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
}

/**
 * 요소 텍스트 오류 처리
 * @param {Error} error - 발생한 오류
 * @param {Element} element - 대상 요소
 * @param {string} originalText - 원본 텍스트
 * @returns {boolean} - 항상 false 반환 (오류 발생)
 */
function handleElementTextError(error, element, originalText) {
  console.error(`[${APP_CONFIG.appName}] 요소 텍스트 교체 오류:`, error);
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
      switch (item.type) {
        case 'attribute':
          if (item.attribute) {
            success = replaceElementAttribute(item.element, item.attribute, item.translated);
          }
          break;
          
        case 'text':
          if (item.node && item.node.nodeType === Node.TEXT_NODE) {
            success = replaceTextNodeContent(item.node, item.translated);
          }
          break;
          
        default:
          // 요소 텍스트 직접 번역
          success = replaceElementText(item.element, item.translated);
          break;
      }
      
      if (success) {
        successCount++;
      }
    } catch (itemError) {
      console.warn(`[${APP_CONFIG.appName}] 번역 항목 적용 오류:`, itemError);
      state.failedCount++;
    }
  });
  
  // 번역 개수 업데이트
  state.translationCount += successCount;
  
  // 이벤트 발생
  dispatchTextReplacedEvent(successCount, translatedItems.length);
  
  console.log(`[${APP_CONFIG.appName}] ${successCount}개 번역 적용 완료 (${translatedItems.length - successCount}개 실패)`);
  
  return successCount;
}

/**
 * 텍스트 교체 이벤트 발행
 * @param {number} successCount - 성공한 번역 수
 * @param {number} totalCount - 전체 번역 수
 */
function dispatchTextReplacedEvent(successCount, totalCount) {
  try {
    safeDispatchEvent('dom:text-replaced', { 
      count: successCount,
      total: totalCount,
      failed: totalCount - successCount
    });
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 이벤트 발행 오류:`, error);
  }
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
      console.warn(`[${APP_CONFIG.appName}] 요소 상태 업데이트 오류:`, elementError);
    }
  });
}

/**
 * 디버그 모드 설정
 * @param {boolean} enabled - 활성화 여부
 */
function setDebugMode(enabled) {
  state.debugMode = !!enabled; // 불리언 타입 강제
  
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
  
  console.log(`[${APP_CONFIG.appName}] 디버그 모드 ${state.debugMode ? '활성화' : '비활성화'}`);
}

/**
 * 번역 요소 리셋
 * @param {Element[]} elements - 요소 배열 (없으면 모든 번역 요소)
 * @returns {number} - 리셋된 요소 수
 */
function resetTranslatedElements(elements) {
  try {
    const targetElements = elements || 
      document.querySelectorAll(`[${settings.translatedAttr}]`);
    
    let count = 0;
    
    targetElements.forEach(element => {
      try {
        if (element && element instanceof Element) {
          // 원본 텍스트 복원 및 속성 제거
          count += restoreOriginalContent(element);
          
          // 번역 관련 클래스 및 속성 제거
          removeTranslationMarkers(element);
        }
      } catch (elementError) {
        console.warn(`[${APP_CONFIG.appName}] 요소 리셋 오류:`, elementError);
      }
    });
    
    console.log(`[${APP_CONFIG.appName}] ${count}개 번역 요소 리셋 완료`);
    
    return count;
  } catch (error) {
    handleError('번역 요소 리셋 오류', error);
    return 0;
  }
}

/**
 * 요소의 원본 내용 복원
 * @param {Element} element - 대상 요소
 * @returns {number} - 복원된 항목 수
 */
function restoreOriginalContent(element) {
  let count = 0;
  
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
  
  return count;
}

/**
 * 번역 마커 제거
 * @param {Element} element - 대상 요소
 */
function removeTranslationMarkers(element) {
  // 번역 관련 속성 제거
  element.removeAttribute(settings.translatedAttr);
  
  if (element.hasAttribute(settings.pendingAttr)) {
    element.removeAttribute(settings.pendingAttr);
  }
  
  // 번역 관련 클래스 제거
  if (settings.translationClass) {
    element.classList.remove(settings.translationClass);
  }
  
  element.classList.remove('tony-translating', 'tony-error');
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
    if (isStyleSettingChanged(oldSettings)) {
      refreshStyles();
    }
  } catch (error) {
    handleError('설정 업데이트 오류', error);
  }
}

/**
 * 스타일 관련 설정 변경 확인
 * @param {Object} oldSettings - 이전 설정
 * @returns {boolean} - 변경 여부
 */
function isStyleSettingChanged(oldSettings) {
  return oldSettings.translationClass !== settings.translationClass ||
         oldSettings.animateChanges !== settings.animateChanges ||
         oldSettings.keepOriginalOnHover !== settings.keepOriginalOnHover ||
         oldSettings.highlightTranslated !== settings.highlightTranslated;
}

/**
 * 스타일 새로고침
 */
function refreshStyles() {
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

/**
 * 현재 설정 가져오기
 * @returns {Object} - 현재 설정
 */
function getSettings() {
  return { ...settings };
}

/**
 * 오류 처리
 * @param {string} message - 오류 메시지
 * @param {Error} error - 오류 객체
 */
function handleError(message, error) {
  console.error(`[${APP_CONFIG.appName}] ${message}:`, error);
  state.lastError = error;
  
  // 오류 이벤트 발행
  try {
    safeDispatchEvent('dommanipulator:error', {
      message,
      error: error.message
    });
  } catch (eventError) {
    console.warn(`[${APP_CONFIG.appName}] 이벤트 발행 오류:`, eventError);
  }
}

// 모듈 내보내기
export {
  applyTranslations,
  markElementsAsTranslated,
  setDebugMode,
  resetTranslatedElements,
  getStatistics,
  updateSettings,
  getSettings,
  injectStyles
};