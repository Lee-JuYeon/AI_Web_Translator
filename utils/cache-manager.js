// cache-manager.js - TonyConfig 활용 리팩토링 버전
const CacheManager = (function() {
  'use strict';
  
  // 이미 초기화된 경우 중복 실행 방지
  if (window.cacheManagerInitialized) {
    console.log(`[${TonyConfig.APP_CONFIG.appName}] CacheManager 이미 초기화됨`);
    return window.CacheManager;
  }
  
  // 초기화 플래그 설정
  window.cacheManagerInitialized = true;
  
  // 캐시 설정 (TonyConfig에서 가져옴)
  const CACHE_SETTINGS = { ...TonyConfig.APP_CONFIG.cacheSettings };
  
  /**
   * 캐시에서 번역 가져오기
   * @param {string} text - 원본 텍스트
   * @param {string} targetLang - 대상 언어 코드
   * @returns {Promise<string|null>} - 캐시된 번역 또는 null
   */
  async function get(text, targetLang) {
    // 유효성 검사
    if (!text || typeof text !== 'string' || !targetLang) {
      return null;
    }
    
    const key = getCacheKey(text, targetLang);
    
    try {
      const data = await fetchFromStorage(key);
      
      if (!data) return null;
      
      // 만료 여부 확인
      if (isExpired(data.timestamp)) {
        await remove(text, targetLang);
        return null;
      }
      
      console.log(`[${TonyConfig.APP_CONFIG.appName}] 캐시에서 번역 불러옴: ${text.substring(0, 20)}...`);
      return data.translation;
    } catch (error) {
      handleError('캐시 읽기 오류', error);
      return null;
    }
  }
  
  /**
   * 캐시에서 데이터 가져오기
   * @param {string} key - 캐시 키
   * @returns {Promise<Object|null>} - 캐시된 데이터 또는 null
   */
  async function fetchFromStorage(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        // 결과가 없거나 크롬 API 오류 발생 시
        if (chrome.runtime.lastError) {
          console.warn(`[${TonyConfig.APP_CONFIG.appName}] 캐시 조회 오류:`, chrome.runtime.lastError);
          resolve(null);
          return;
        }
        
        resolve(result[key]);
      });
    });
  }
  
  /**
   * 캐시 항목 만료 여부 확인
   * @param {number} timestamp - 저장 시간
   * @returns {boolean} - 만료 여부
   */
  function isExpired(timestamp) {
    const expiryTime = CACHE_SETTINGS.expiryDays * 24 * 60 * 60 * 1000;
    return !timestamp || (Date.now() - timestamp > expiryTime);
  }
  
  /**
   * 번역 결과를 캐시에 저장
   * @param {string} text - 원본 텍스트
   * @param {string} translation - 번역된 텍스트
   * @param {string} targetLang - 대상 언어 코드
   * @returns {Promise<boolean>} - 저장 성공 여부
   */
  async function set(text, translation, targetLang) {
    // 유효성 검사
    if (!text || !translation || !targetLang) {
      return false;
    }
    
    const key = getCacheKey(text, targetLang);
    const data = {
      translation,
      timestamp: Date.now() // 현재 시간 기록
    };
    
    try {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: data }, () => {
          if (chrome.runtime.lastError) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 캐시 저장 오류:`, chrome.runtime.lastError);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
    } catch (error) {
      handleError('캐시 저장 오류', error);
      return false;
    }
  }
  
  /**
   * 캐시에서 번역 제거
   * @param {string} text - 원본 텍스트
   * @param {string} targetLang - 대상 언어 코드
   * @returns {Promise<boolean>} - 제거 성공 여부
   */
  async function remove(text, targetLang) {
    const key = getCacheKey(text, targetLang);
    
    try {
      return new Promise((resolve) => {
        chrome.storage.local.remove(key, () => {
          if (chrome.runtime.lastError) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 캐시 제거 오류:`, chrome.runtime.lastError);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
    } catch (error) {
      handleError('캐시 제거 오류', error);
      return false;
    }
  }
  
  /**
   * 캐시 검색 키 생성
   * @param {string} text - 원본 텍스트
   * @param {string} targetLang - 대상 언어 코드
   * @returns {string} - 캐시 키
   */
  function getCacheKey(text, targetLang) {
    // 텍스트에서 공백 제거하고 해시 생성 (단순화된 해싱)
    const simpleHash = text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .split('')
      .reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0)
      .toString(36);
    
    return `${CACHE_SETTINGS.keyPrefix}${targetLang}_${simpleHash}`;
  }
  
  /**
   * 캐시 통계 가져오기
   * @returns {Promise<Object>} - 캐시 통계 (count, size)
   */
  async function getStats() {
    try {
      return new Promise((resolve) => {
        chrome.storage.local.get(null, (items) => {
          if (chrome.runtime.lastError) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 캐시 통계 수집 오류:`, chrome.runtime.lastError);
            resolve({ count: 0, size: 0 });
            return;
          }
          
          const cacheKeys = Object.keys(items).filter(key => 
            key.startsWith(CACHE_SETTINGS.keyPrefix)
          );
          
          // 캐시 크기 계산 (대략적인 JSON 크기)
          const cacheItems = {};
          cacheKeys.forEach(key => {
            cacheItems[key] = items[key];
          });
          
          const cacheSize = JSON.stringify(cacheItems).length;
          
          resolve({
            count: cacheKeys.length,
            size: cacheSize,
            sizeFormatted: formatSize(cacheSize)
          });
        });
      });
    } catch (error) {
      handleError('캐시 통계 수집 오류', error);
      return { count: 0, size: 0, sizeFormatted: '0 B' };
    }
  }
  
  /**
   * 바이트 크기를 사람이 읽기 쉬운 형식으로 변환
   * @param {number} bytes - 바이트 크기
   * @returns {string} - 포맷된 크기 문자열
   */
  function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const formattedSize = parseFloat((bytes / Math.pow(1024, i)).toFixed(2));
    
    return `${formattedSize} ${sizes[i]}`;
  }
  
  /**
   * 오래된 캐시 정리
   * @returns {Promise<number>} - 삭제된 항목 수
   */
  async function cleanupExpired() {
    const now = Date.now();
    const expiryTime = CACHE_SETTINGS.expiryDays * 24 * 60 * 60 * 1000;
    
    try {
      return new Promise((resolve) => {
        chrome.storage.local.get(null, (items) => {
          if (chrome.runtime.lastError) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 캐시 정리 조회 오류:`, chrome.runtime.lastError);
            resolve(0);
            return;
          }
          
          // 만료된 항목 키 찾기
          const expiredKeys = Object.keys(items)
            .filter(key => {
              // 캐시 항목이며, 만료 시간이 지난 항목만 필터링
              return key.startsWith(CACHE_SETTINGS.keyPrefix) && 
                     items[key].timestamp && 
                     (now - items[key].timestamp > expiryTime);
            });
          
          if (expiredKeys.length > 0) {
            chrome.storage.local.remove(expiredKeys, () => {
              if (chrome.runtime.lastError) {
                console.warn(`[${TonyConfig.APP_CONFIG.appName}] 만료 캐시 제거 오류:`, chrome.runtime.lastError);
                resolve(0);
              } else {
                console.log(`[${TonyConfig.APP_CONFIG.appName}] ${expiredKeys.length}개의 만료된 캐시 항목 삭제됨`);
                resolve(expiredKeys.length);
              }
            });
          } else {
            resolve(0);
          }
        });
      });
    } catch (error) {
      handleError('캐시 정리 오류', error);
      return 0;
    }
  }
  
  /**
   * 모든 캐시 정리
   * @returns {Promise<number>} - 삭제된 항목 수
   */
  async function clearAll() {
    try {
      return new Promise((resolve) => {
        chrome.storage.local.get(null, (items) => {
          if (chrome.runtime.lastError) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 전체 캐시 정리 조회 오류:`, chrome.runtime.lastError);
            resolve(0);
            return;
          }
          
          // 모든 캐시 항목 찾기
          const cacheKeys = Object.keys(items)
            .filter(key => key.startsWith(CACHE_SETTINGS.keyPrefix));
          
          if (cacheKeys.length > 0) {
            chrome.storage.local.remove(cacheKeys, () => {
              if (chrome.runtime.lastError) {
                console.warn(`[${TonyConfig.APP_CONFIG.appName}] 전체 캐시 제거 오류:`, chrome.runtime.lastError);
                resolve(0);
              } else {
                console.log(`[${TonyConfig.APP_CONFIG.appName}] ${cacheKeys.length}개의 캐시 항목 모두 삭제됨`);
                resolve(cacheKeys.length);
              }
            });
          } else {
            resolve(0);
          }
        });
      });
    } catch (error) {
      handleError('전체 캐시 정리 오류', error);
      return 0;
    }
  }
  
  /**
   * 오류 처리
   * @param {string} message - 오류 메시지
   * @param {Error} error - 오류 객체
   */
  function handleError(message, error) {
    console.error(`[${TonyConfig.APP_CONFIG.appName}] ${message}:`, error);
    
    // 오류 이벤트 발행
    try {
      TonyConfig.safeDispatchEvent('cache:error', {
        message,
        error: error.message
      });
    } catch (eventError) {
      console.warn(`[${TonyConfig.APP_CONFIG.appName}] 이벤트 발행 오류:`, eventError);
    }
  }
  
  /**
   * 캐시 설정 업데이트
   * @param {Object} newSettings - 새 설정 값
   */
  function updateSettings(newSettings) {
    if (!newSettings) return;
    
    // 기존 설정과 다른 부분만 업데이트하여 로그 출력
    Object.entries(newSettings).forEach(([key, value]) => {
      if (CACHE_SETTINGS[key] !== value) {
        console.log(`[${TonyConfig.APP_CONFIG.appName}] 캐시 설정 변경: ${key} = ${value}`);
        CACHE_SETTINGS[key] = value;
      }
    });
  }
  
  /**
   * 현재 캐시 설정 가져오기
   * @returns {Object} - 현재 캐시 설정
   */
  function getSettings() {
    return {...CACHE_SETTINGS};
  }
  
  // 공개 API
  return {
    get,
    set,
    remove,
    getStats,
    cleanupExpired,
    clearAll,
    updateSettings,
    getSettings
  };
})();

// 모듈 내보내기
window.CacheManager = CacheManager;