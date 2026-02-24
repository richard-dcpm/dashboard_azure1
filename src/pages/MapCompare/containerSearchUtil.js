// containerSearchUtil.js
// Utility functions for searching and filtering containers

/**
 * Priority order for containers
 */
const CONTAINER_PRIORITY = ["raw", "processed", "projects", "uploads", "issued"];

/**
 * Get the priority index of a container (lower = higher priority)
 * @param {string} containerName - Name of the container
 * @returns {number} Priority index (0-4), or 999 if not in priority list
 */
function getContainerPriority(containerName) {
  const normalized = containerName.toLowerCase();
  const index = CONTAINER_PRIORITY.indexOf(normalized);
  return index >= 0 ? index : 999;
}

/**
 * Sort containers by priority order
 * @param {string[]} containers - Array of container names
 * @returns {string[]} Sorted array
 */
function sortContainersByPriority(containers) {
  return [...containers].sort((a, b) => {
    return getContainerPriority(a) - getContainerPriority(b);
  });
}

/**
 * Filter containers based on search query
 * @param {string[]} containers - Array of container names
 * @param {string} query - Search query
 * @returns {string[]} Filtered containers
 */
function filterContainers(containers, query) {
  if (!query || query.trim() === "") return containers;
  
  const searchTerm = query.toLowerCase().trim();
  return containers.filter(container => 
    container.toLowerCase().includes(searchTerm)
  );
}

/**
 * Search containers with priority ordering
 * @param {string[]} containers - Array of container names
 * @param {string} query - Search query (optional)
 * @returns {string[]} Filtered and sorted containers
 */
export function searchContainers(containers, query = "") {
  const filtered = filterContainers(containers, query);
  return sortContainersByPriority(filtered);
}

/**
 * Filter containers to only include those in the priority list
 * @param {string[]} containers - Array of container names
 * @returns {string[]} Only containers from priority list, sorted
 */
export function filterToPriorityContainers(containers) {
  const prioritySet = new Set(CONTAINER_PRIORITY);
  const filtered = containers.filter(c => prioritySet.has(c.toLowerCase()));
  return sortContainersByPriority(filtered);
}

/**
 * Search within a specific container's files
 * @param {Array} files - Array of file objects with 'name' property
 * @param {string} query - Search query
 * @returns {Array} Filtered files
 */
export function searchFilesInContainer(files, query) {
  if (!query || query.trim() === "") return files;
  
  const searchTerm = query.toLowerCase().trim();
  return files.filter(file => 
    file.name?.toLowerCase().includes(searchTerm) ||
    file.fullName?.toLowerCase().includes(searchTerm)
  );
}

/**
 * Advanced search across multiple containers
 * @param {Object} params
 * @param {string[]} params.containers - Available containers
 * @param {string} params.query - Search query
 * @param {Function} params.getFilesForContainer - Async function to get files for a container
 * @returns {Promise<Object>} Results grouped by container
 */
export async function searchAcrossContainers({ 
  containers, 
  query, 
  getFilesForContainer 
}) {
  const results = {};
  const searchTerm = query.toLowerCase().trim();
  
  // Filter containers that match the query
  const matchingContainers = containers.filter(c => 
    c.toLowerCase().includes(searchTerm)
  );
  
  // For each matching container, optionally search within files
  for (const container of matchingContainers) {
    try {
      const files = await getFilesForContainer(container);
      const matchingFiles = searchFilesInContainer(files, query);
      
      if (matchingFiles.length > 0) {
        results[container] = matchingFiles;
      }
    } catch (error) {
      console.warn(`Error searching in container ${container}:`, error);
    }
  }
  
  return results;
}

/**
 * Get container by exact name (case-insensitive)
 * @param {string[]} containers - Available containers
 * @param {string} targetName - Container name to find
 * @returns {string|null} Found container name or null
 */
export function findContainerByName(containers, targetName) {
  const normalized = targetName.toLowerCase();
  return containers.find(c => c.toLowerCase() === normalized) || null;
}

/**
 * Check if container is in priority list
 * @param {string} containerName - Container name to check
 * @returns {boolean}
 */
export function isPriorityContainer(containerName) {
  return CONTAINER_PRIORITY.includes(containerName.toLowerCase());
}

/**
 * Get suggestions for container search (fuzzy matching)
 * @param {string[]} containers - Available containers
 * @param {string} query - Partial query
 * @returns {string[]} Suggested containers
 */
export function getContainerSuggestions(containers, query) {
  if (!query || query.trim() === "") return sortContainersByPriority(containers);
  
  const searchTerm = query.toLowerCase();
  
  // Exact matches first
  const exactMatches = containers.filter(c => 
    c.toLowerCase() === searchTerm
  );
  
  // Starts with matches
  const startsWithMatches = containers.filter(c => 
    c.toLowerCase().startsWith(searchTerm) && 
    !exactMatches.includes(c)
  );
  
  // Contains matches
  const containsMatches = containers.filter(c => 
    c.toLowerCase().includes(searchTerm) && 
    !exactMatches.includes(c) && 
    !startsWithMatches.includes(c)
  );
  
  const allMatches = [...exactMatches, ...startsWithMatches, ...containsMatches];
  return sortContainersByPriority(allMatches);
}

export default {
  searchContainers,
  filterToPriorityContainers,
  searchFilesInContainer,
  searchAcrossContainers,
  findContainerByName,
  isPriorityContainer,
  getContainerSuggestions
};