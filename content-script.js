/**
 * XPath로 요소 찾기
 */
function getElementByXPath(xpath) {
  try {
    return document.evaluate(
      xpath, 
      document, 
      null, 
      XPathResult.FIRST_ORDERED_NODE_TYPE, 
      null
    ).singleNodeValue;
  } catch (e) {
    console.error('[번역 익스텐션] XPath 평가 오류:', e, xpath);
    return null;
  }
}

/**
 * 번역 상태 UI 생성 및 표시
 */
function showTranslationStatus(message, isComplete = false) {
  let statusElement = document.getElementById('translation-status-bar');
  
  if (!statusElement) {
    statusElement = document.createElement('div');
    statusElement.id = 'translation-status-bar';
    
    // 스타일 설정
    Object.assign(statusElement.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      padding: '10px 15px',
      background: isComplete ? '#4CAF50' : '#2196F3',
      color: 'white',
      borderRadius: '5px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      zIndex: '9999',
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      transition: 'all 0.3s ease'
    });
    
    document.body.appendChild(statusElement);
  } else {
    // 완료 상태일 경우 색상 변경
    if (isComplete) {
      statusElement.style.background = '#4CAF50';
    } else {
      statusElement.style.background = '#2196F3';
    }
  }
  
  statusElement.textContent = message;
}

/**
 * 번역 상태 UI 숨기기
 */
function hideTranslationStatus() {
  const statusElement = document.getElementById('translation-status-bar');
  if (statusElement) {
    // 애니메이션 후 제거
    statusElement.style.opacity = '0';
    setTimeout(() => {
      if (statusElement.parentNode) {
        statusElement.parentNode.removeChild(statusElement);
      }
    }, 300);
  }
}

// 페이지 로드 완료 시 자동 번역 옵션 (설정에 따라 활성화)
document.addEventListener('DOMContentLoaded', () => {
  // chrome.storage.sync.get('settings', (data) => {
  //   if (data.settings && data.settings.autoTranslate) {
  //     translatePage();
  //   }
  // });
  
  // 주기적으로 오래된 캐시 정리 (옵션)
  // setTimeout(() => TranslationCache.cleanupExpired(), 10000);
});
// content-script.js
// 최적화된 번역 익스텐션 (캐싱, 스크롤 감지, 최적 배치)

// 설정값
const SETTINGS = {
  apiKey: '123123', // Gemini API 키 (임시값)
  apiModel: 'gemini-1.5-flash', // Gemini 모델명
  apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash', // API 엔드포인트
  targetLang: 'ko',  // 대상 언어 (한국어)
  minTextLength: 2,  // 번역할 최소 텍스트 길이
  cacheExpiry: 30,   // 캐시 만료일 (일)
  batchSize: 40,     // Gemini 1.5 Flash의 토큰 한계에 맞춘 최적 배치 크기
  maxConcurrentBatches: 3, // 최대 동시 배치 처리 수
  scrollThreshold: 200 // 스크롤 감지 임계값 (픽셀)
};

// 번역 상태 관리
const TranslationState = {
  isTranslating: false,
  processedNodes: new WeakSet(), // 이미 처리된 노드 추적
  pendingTranslation: [],        // 번역 대기 중인 노드
  visibleNodes: [],              // 현재 화면에 보이는 노드
  lastScrollPosition: 0,         // 마지막 스크롤 위치
  scrollTimer: null,             // 스크롤 타이머
  
  // 번역 상태 초기화
  reset() {
    this.isTranslating = false;
    this.pendingTranslation = [];
    this.visibleNodes = [];
  }
};

// 번역 캐시 관리 객체
const TranslationCache = {
  // 캐시에서 번역 가져오기
  async get(text, targetLang) {
    const key = this._getCacheKey(text, targetLang);
    
    try {
      const data = await new Promise((resolve) => {
        chrome.storage.local.get(key, (result) => {
          resolve(result[key]);
        });
      });
      
      if (!data) return null;
      
      // 만료 시간 확인
      if (data.timestamp && Date.now() - data.timestamp > SETTINGS.cacheExpiry * 24 * 60 * 60 * 1000) {
        this.remove(text, targetLang);
        return null;
      }
      
      console.log(`[번역 익스텐션] 캐시에서 번역 불러옴: ${text.substring(0, 20)}...`);
      return data.translation;
    } catch (e) {
      console.error("캐시 읽기 오류:", e);
      return null;
    }
  },
  
  // 번역 결과를 캐시에 저장
  set(text, translation, targetLang) {
    const key = this._getCacheKey(text, targetLang);
    const data = {
      translation,
      timestamp: Date.now() // 현재 시간 기록
    };
    
    chrome.storage.local.set({ [key]: data });
  },
  
  // 캐시에서 번역 제거
  remove(text, targetLang) {
    const key = this._getCacheKey(text, targetLang);
    chrome.storage.local.remove(key);
  },
  
  // 캐시 검색 키 생성
  _getCacheKey(text, targetLang) {
    // 텍스트에서 공백 제거하고 해시 생성 (단순화된 해싱)
    const simpleHash = text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .split('')
      .reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0)
      .toString(36);
    
    return `translate_${targetLang}_${simpleHash}`;
  },
  
  // 캐시 통계 가져오기
  async getStats() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const cacheKeys = Object.keys(items).filter(key => key.startsWith('translate_'));
        resolve({
          count: cacheKeys.length,
          size: JSON.stringify(items).length
        });
      });
    });
  },
  
  // 오래된 캐시 정리
  async cleanupExpired() {
    const now = Date.now();
    const expiryTime = SETTINGS.cacheExpiry * 24 * 60 * 60 * 1000;
    
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const expiredKeys = Object.keys(items)
          .filter(key => key.startsWith('translate_') && items[key].timestamp && (now - items[key].timestamp > expiryTime));
        
        if (expiredKeys.length > 0) {
          chrome.storage.local.remove(expiredKeys, () => {
            console.log(`[번역 익스텐션] ${expiredKeys.length}개의 만료된 캐시 항목 삭제`);
            resolve(expiredKeys.length);
          });
        } else {
          resolve(0);
        }
      });
    });
  }
};

// 백그라운드 스크립트로부터 메시지 수신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "translatePage") {
    translatePage().then(result => {
      sendResponse({ success: true, result });
    }).catch(error => {
      console.error("[번역 익스텐션] 오류:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 비동기 응답을 위해 true 반환
  }
});

/**
 * 웹페이지 번역 프로세스 - 최적화 버전
 */
async function translatePage() {
  console.log("[번역 익스텐션] 페이지 번역 시작");
  
  // 이미 번역 중이면 중복 실행 방지
  if (TranslationState.isTranslating) {
    return "이미 번역 중입니다.";
  }
  
  TranslationState.isTranslating = true;
  TranslationState.reset();
  
  // 번역 진행 상태 표시
  showTranslationStatus("번역 준비 중...");
  
  try {
    // 스크롤 이벤트 리스너 등록
    setupScrollListener();
    
    // 현재 화면에 보이는 텍스트 노드 추출 및 번역
    await translateVisibleContent();
    
    // 완료 메시지 표시
    showTranslationStatus("번역 완료!", true);
    setTimeout(() => {
      hideTranslationStatus();
    }, 2000);
    
    // 번역 상태 업데이트
    TranslationState.isTranslating = false;
    
    return "현재 보이는 콘텐츠 번역 완료. 스크롤 시 추가 콘텐츠가 번역됩니다.";
  } catch (error) {
    hideTranslationStatus();
    TranslationState.isTranslating = false;
    console.error("[번역 익스텐션] 번역 오류:", error);
    throw error;
  }
}

/**
 * 스크롤 이벤트 리스너 설정
 */
function setupScrollListener() {
  // 이미 리스너가 있다면 추가하지 않음
  if (window.hasScrollListener) return;
  
  window.addEventListener('scroll', handleScroll);
  window.hasScrollListener = true;
  console.log("[번역 익스텐션] 스크롤 감지 활성화");
  
  // 페이지 언로드 시 리스너 제거
  window.addEventListener('beforeunload', () => {
    window.removeEventListener('scroll', handleScroll);
    window.hasScrollListener = false;
  });
}

/**
 * 스크롤 이벤트 핸들러
 */
function handleScroll() {
  // 이미 타이머가 있으면 초기화
  if (TranslationState.scrollTimer) {
    clearTimeout(TranslationState.scrollTimer);
  }
  
  // 스크롤 종료 후 일정 시간 후에 번역 수행
  TranslationState.scrollTimer = setTimeout(async () => {
    // 현재 스크롤 위치가 이전과 충분히 다른 경우만 처리
    const currentScrollY = window.scrollY;
    if (Math.abs(currentScrollY - TranslationState.lastScrollPosition) > SETTINGS.scrollThreshold) {
      TranslationState.lastScrollPosition = currentScrollY;
      
      // 번역 중이 아닐 때만 실행
      if (!TranslationState.isTranslating) {
        console.log("[번역 익스텐션] 스크롤 감지, 새 콘텐츠 확인");
        await translateVisibleContent();
      }
    }
  }, 500); // 스크롤 종료 후 500ms 대기
}

/**
 * 현재 화면에 보이는 콘텐츠 번역
 */
async function translateVisibleContent() {
  TranslationState.isTranslating = true;
  
  try {
    // 현재 화면에 보이는 노드 추출
    const visibleNodes = extractVisibleTextNodes(document.body);
    console.log(`[번역 익스텐션] 화면에 보이는 텍스트 노드: ${visibleNodes.length}개`);
    
    // 번역할 텍스트 정보 리스트 구성
    const textList = [];
    
    visibleNodes.forEach(node => {
      // 이미 처리된 노드는 건너뜀
      if (TranslationState.processedNodes.has(node)) {
        return;
      }
      
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text && text.length >= SETTINGS.minTextLength) {
          // XPath로 위치 정보 저장
          const xpath = getXPathForNode(node);
          textList.push([text, "", xpath, node]);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // 속성에 있는 텍스트 (alt, title, placeholder 등)
        ['title', 'alt', 'placeholder', 'value'].forEach(attr => {
          if (node.hasAttribute(attr) && node.getAttribute(attr).trim().length >= SETTINGS.minTextLength) {
            const attrValue = node.getAttribute(attr);
            const attrInfo = `${getXPathForElement(node)}|attr:${attr}`;
            textList.push([attrValue, "", attrInfo, node]);
          }
        });
      }
      
      // 처리된 노드로 표시
      TranslationState.processedNodes.add(node);
    });
    
    console.log(`[번역 익스텐션] 번역할 텍스트 항목: ${textList.length}개`);
    
    if (textList.length === 0) {
      TranslationState.isTranslating = false;
      return "번역할 새 텍스트가 없습니다.";
    }
    
    // 캐시 체크 및 API로 번역이 필요한 텍스트 필터링
    showTranslationStatus("캐시 확인 중...");
    const needTranslation = [];
    const cachedTranslations = [];
    
    // 모든 텍스트에 대해 캐시 확인
    await Promise.all(textList.map(async (item) => {
      const cachedTranslation = await TranslationCache.get(item[0], SETTINGS.targetLang);
      
      if (cachedTranslation) {
        // 캐시에서 번역을 찾은 경우
        cachedTranslations.push([item[0], cachedTranslation, item[2]]);
      } else {
        // 번역이 필요한 텍스트 목록에 추가
        needTranslation.push(item);
      }
    }));
    
    console.log(`[번역 익스텐션] 캐시 히트: ${cachedTranslations.length}개, 번역 필요: ${needTranslation.length}개`);
    
    // 캐시된 번역 먼저 적용 (API 호출 전에 빠른 피드백)
    if (cachedTranslations.length > 0) {
      showTranslationStatus(`캐시된 ${cachedTranslations.length}개 항목 적용 중...`);
      replaceTextsInDOM(cachedTranslations);
    }
    
    // 번역이 필요한 텍스트가 있는 경우에만 API 호출
    let newTranslations = [];
    
    if (needTranslation.length > 0) {
      // 텍스트 최적화: 중복 제거
      const uniqueTextsMap = new Map(); // 원본 텍스트 → [항목들]
      
      // 중복 텍스트 그룹화
      needTranslation.forEach(item => {
        const originalText = item[0];
        if (!uniqueTextsMap.has(originalText)) {
          uniqueTextsMap.set(originalText, []);
        }
        uniqueTextsMap.get(originalText).push(item);
      });
      
      // 고유 텍스트 항목 추출
      const uniqueItems = Array.from(uniqueTextsMap.entries()).map(([text, items]) => {
        return items[0]; // 각 그룹의 첫 번째 항목 사용
      });
      
      console.log(`[번역 익스텐션] 중복 제거 후 번역할 고유 텍스트: ${uniqueItems.length}개`);
      
      // 배치로 나누기
      const batches = [];
      for (let i = 0; i < uniqueItems.length; i += SETTINGS.batchSize) {
        batches.push(uniqueItems.slice(i, i + SETTINGS.batchSize));
      }
      
      console.log(`[번역 익스텐션] 총 ${batches.length}개 배치로 처리`);
      
      // 배치 처리 시작
      showTranslationStatus(`${needTranslation.length}개 항목 번역 중... (0/${batches.length} 배치)`);
      
      // 병렬 처리를 위한 변수
      let completedBatches = 0;
      const uniqueTranslations = new Map(); // 원본 텍스트 → 번역
      
      // 제한된 동시 요청으로 배치 처리
      for (let i = 0; i < batches.length; i += SETTINGS.maxConcurrentBatches) {
        const currentBatches = batches.slice(i, i + SETTINGS.maxConcurrentBatches);
        const batchPromises = currentBatches.map(batch => {
          return translateBatch(batch).then(results => {
            completedBatches++;
            showTranslationStatus(`${needTranslation.length}개 항목 번역 중... (${completedBatches}/${batches.length} 배치)`);
            return results;
          });
        });
        
        // 현재 그룹의 배치 결과 처리
        const batchResults = await Promise.all(batchPromises);
        
        // 결과를 uniqueTranslations 맵에 추가
        batchResults.forEach(batchResult => {
          batchResult.forEach(([original, translated]) => {
            uniqueTranslations.set(original, translated);
          });
        });
      }
      
      // 모든 필요한 항목에 대해 번역 결과 매핑
      newTranslations = needTranslation.map(item => {
        const originalText = item[0];
        const translation = uniqueTranslations.get(originalText) || originalText;
        
        // 번역 결과를 캐시에 저장 (각 고유 텍스트당 한 번만)
        if (translation !== originalText && 
            uniqueTranslations.get(originalText) === translation) {
          TranslationCache.set(originalText, translation, SETTINGS.targetLang);
        }
        
        return [originalText, translation, item[2]];
      });
      
      // 새로 번역된 텍스트 적용
      showTranslationStatus(`새로 번역된 ${newTranslations.length}개 항목 적용 중...`);
      replaceTextsInDOM(newTranslations);
    }
    
    // 모든 번역 항목 수 계산
    const totalTranslated = cachedTranslations.length + newTranslations.length;
    
    // 완료 메시지 표시
    showTranslationStatus(`번역 완료! (캐시: ${cachedTranslations.length}, 신규: ${newTranslations.length})`, true);
    
    TranslationState.isTranslating = false;
    return `${totalTranslated}개 항목 번역 완료`;
  } catch (error) {
    TranslationState.isTranslating = false;
    throw error;
  }
}

/**
 * 배치 번역 함수
 * @param {Array} batch 번역할 항목 배치
 * @returns {Promise<Array>} [원본, 번역] 쌍의 배열
 */
async function translateBatch(batch) {
  try {
    // 원본 텍스트만 추출
    const originalTexts = batch.map(item => item[0]);
    
    // Gemini API로 번역
    const translatedTexts = await translateTextsWithGemini(originalTexts);
    
    // 원본과 번역 결과 쌍으로 반환
    return originalTexts.map((original, index) => {
      return [original, translatedTexts[index] || original];
    });
  } catch (error) {
    console.error("[번역 익스텐션] 배치 번역 오류:", error);
    // 오류 발생 시 원본 반환
    return batch.map(item => [item[0], item[0]]);
  }
}

/**
 * Gemini API로 텍스트 번역
 * @param {Array<string>} texts 번역할 텍스트 배열
 * @returns {Promise<Array<string>>} 번역된 텍스트 배열
 */
async function translateTextsWithGemini(texts) {
  try {
    // 텍스트에 구분자 추가
    const separator = "||TRANSLATE_SEPARATOR||";
    const joinedTexts = texts.join(separator);
    
    // Gemini API 프롬프트 구성
    const promptText = `다음 텍스트들을 ${SETTINGS.targetLang === 'ko' ? '한국어' : '대상 언어'}로 자연스럽게 번역해주세요.
각 텍스트는 '${separator}' 구분자로 분리되어 있습니다.
번역 결과도 동일한 구분자로 분리해서 반환해주세요.
원래 텍스트 수와 번역된 텍스트 수가 정확히 일치해야 합니다.
번역만 제공하고 다른 설명은 하지 말아주세요.

${joinedTexts}`;

    // Gemini API 호출
    const response = await callGeminiAPI(promptText);
    
    // 구분자로 분리
    const translations = response.split(separator);
    
    // 번역 결과 개수가 원본과 다른 경우 처리
    if (translations.length !== texts.length) {
      console.warn(`[번역 익스텐션] 번역 결과 개수가 맞지 않습니다. 예상: ${texts.length}, 실제: ${translations.length}`);
      
      // 결과가 부족한 경우 원본으로 채움
      while (translations.length < texts.length) {
        translations.push(texts[translations.length]);
      }
      
      // 결과가 많은 경우 잘라냄
      if (translations.length > texts.length) {
        translations.splice(texts.length);
      }
    }
    
    // 빈 문자열 처리
    return translations.map((text, index) => text.trim() || texts[index]);
  } catch (error) {
    console.error("[번역 익스텐션] Gemini 번역 오류:", error);
    throw error;
  }
}

/**
 * Gemini API 호출 함수
 * @param {string} prompt Gemini에 전달할 프롬프트
 * @returns {Promise<string>} Gemini 응답 텍스트
 */
async function callGeminiAPI(prompt) {
  try {
    console.log("[번역 익스텐션] Gemini API 호출 시작");
    const response = await fetch(`${SETTINGS.apiEndpoint}:generateContent?key=${SETTINGS.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192
        }
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini API 오류: ${errorData.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    console.log("[번역 익스텐션] Gemini API 응답 수신 완료");
    
    // 응답 텍스트 추출
    if (data.candidates && data.candidates.length > 0 && 
        data.candidates[0].content && data.candidates[0].content.parts) {
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Gemini API에서 유효한 응답을 받지 못했습니다.");
    }
  } catch (error) {
    console.error("[번역 익스텐션] Gemini API 호출 오류:", error);
    throw error;
  }
}

/**
 * 현재 화면에 보이는 텍스트 노드 추출
 * @param {Element} element 시작 요소
 * @returns {Array} 화면에 보이는 텍스트 노드 배열
 */
function extractVisibleTextNodes(element) {
  const visibleNodes = [];
  
  // TreeWalker로 모든 노드 탐색
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: function(node) {
        // 스크립트, 스타일, 숨겨진 요소 내 텍스트는 제외
        if (node.parentNode) {
          const parentTag = node.parentNode.tagName ? node.parentNode.tagName.toLowerCase() : '';
          if (parentTag === 'script' || parentTag === 'style' || parentTag === 'noscript' || 
              parentTag === 'code' || parentTag === 'pre') {
            return NodeFilter.FILTER_REJECT;
          }
          
          // CSS로 숨겨진 요소 제외
          if (node.parentNode.nodeType === Node.ELEMENT_NODE) {
            const style = window.getComputedStyle(node.parentNode);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return NodeFilter.FILTER_REJECT;
            }
          }
        }
        
        // 텍스트 노드이고 내용이 있는 경우
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim();
          if (text.length > 0) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
        
        // 특정 속성(title, alt, placeholder 등)을 가진 요소 노드
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.hasAttribute('title') || node.hasAttribute('alt') || 
              node.hasAttribute('placeholder') || 
              (node.tagName === 'INPUT' && node.type !== 'password' && node.hasAttribute('value'))) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        
        return NodeFilter.FILTER_SKIP;
      }
    }
  );
  
  // TreeWalker로 노드 탐색
  let node;
  while (node = walker.nextNode()) {
    // 노드가 화면에 보이는지 확인
    if (isNodeVisible(node)) {
      visibleNodes.push(node);
    }
  }
  
  return visibleNodes;
}

/**
 * 노드가 현재 화면에 보이는지 확인
 * @param {Node} node 확인할 노드
 * @returns {boolean} 화면에 보이는지 여부
 */
function isNodeVisible(node) {
  // 텍스트 노드인 경우 부모 요소 확인
  const element = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  
  // 요소가 없는 경우
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  
  // 요소의 화면 위치 확인
  const rect = element.getBoundingClientRect();
  
  // 화면을 벗어난 경우
  if (rect.top > window.innerHeight || rect.bottom < 0 ||
      rect.left > window.innerWidth || rect.right < 0) {
    return false;
  }
  
  return true;
}

/**
 * 3. 텍스트 노드의 XPath 생성 (위치 정보)
 */
function getXPathForNode(node) {
  // 텍스트 노드인 경우 부모 요소의 XPath + 텍스트 노드 인덱스
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentNode;
    const siblings = Array.from(parent.childNodes);
    const textNodeIndex = siblings.filter(n => n.nodeType === Node.TEXT_NODE).indexOf(node);
    return getXPathForElement(parent) + '/text()[' + (textNodeIndex + 1) + ']';
  }
  
  return getXPathForElement(node);
}

/**
 * 3. 요소의 XPath 생성 (위치 정보)
 */
function getXPathForElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  
  // 문서 루트인 경우
  if (element === document.documentElement) {
    return '/html';
  }
  
  // 부모 요소가 없는 경우
  if (!element.parentNode) {
    return '';
  }
  
  // ID가 있는 경우 (고유 식별자)
  if (element.id) {
    return '//*[@id="' + element.id + '"]';
  }
  
  // 부모 요소의 XPath + 현재 요소 태그 및 위치
  const siblings = Array.from(element.parentNode.children).filter(e => e.tagName === element.tagName);
  
  if (siblings.length === 1) {
    return getXPathForElement(element.parentNode) + '/' + element.tagName.toLowerCase();
  }
  
  const index = siblings.indexOf(element) + 1;
  return getXPathForElement(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + index + ']';
}

/**
 * 5. 번역된 텍스트를 DOM에 적용
 */
function replaceTextsInDOM(translatedTexts) {
  console.log(`[번역 익스텐션] ${translatedTexts.length}개 텍스트 교체 시작`);
  
  let replacedCount = 0;
  translatedTexts.forEach(item => {
    try {
      const [originalText, translatedText, locationInfo] = item;
      
      // 번역되지 않았거나 원본과 동일한 텍스트는 건너뜀
      if (!translatedText || originalText === translatedText) {
        return;
      }
      
      // 속성인 경우 (xpath|attr:속성명)
      if (locationInfo.includes('|attr:')) {
        const [xpath, attrInfo] = locationInfo.split('|attr:');
        const attrName = attrInfo;
        const element = getElementByXPath(xpath);
        
        if (element && element.hasAttribute(attrName)) {
          element.setAttribute(attrName, translatedText);
          replacedCount++;
        }
      } 
      // 텍스트 노드인 경우
      else {
        const textNode = getElementByXPath(locationInfo);
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          textNode.textContent = translatedText;
          replacedCount++;
        }
      }
    } catch (error) {
      console.error("[번역 익스텐션] 텍스트 교체 오류:", error, item);
    }
  });
  
  console.log(`[번역 익스텐션] ${replacedCount}개 텍스트 교체 완료`);
}