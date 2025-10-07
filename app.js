// Configuration - Your backend API URL
const API_BASE_URL = 'http://74.140.131.120'; // Backend server

// Check if user is logged in
async function checkAuth() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/user`, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (response.ok) {
      const user = await response.json();
      updateUIForLoggedInUser(user);
    } else {
      updateUIForLoggedOutUser();
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    updateUIForLoggedOutUser();
  }
}

function updateUIForLoggedInUser(user) {
  const authBtn = document.getElementById('auth-btn');
  authBtn.textContent = user.username;
  authBtn.href = '#';
  authBtn.onclick = (e) => {
    e.preventDefault();
    showDashboard(user);
  };

  // Show dashboard section
  document.getElementById('dashboard-section').style.display = 'block';
  loadDashboardData(user);
}

function updateUIForLoggedOutUser() {
  const authBtn = document.getElementById('auth-btn');
  authBtn.textContent = 'Login with Discord';
  authBtn.href = `${API_BASE_URL}/auth/login`;
  authBtn.onclick = null;
}

async function loadDashboardData(user) {
  try {
    // Load economy data
    const economyResponse = await fetch(`${API_BASE_URL}/api/economy/${user.id}`, {
      credentials: 'include'
    });
    
    if (economyResponse.ok) {
      const economy = await economyResponse.json();
      displayEconomyInfo(economy);
    }

    // Display user info
    displayUserInfo(user);
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
  }
}

function displayUserInfo(user) {
  const userInfoDiv = document.getElementById('user-info');
  const avatarUrl = user.avatar 
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';
  
  userInfoDiv.innerHTML = `
    <div style="display: flex; align-items: center; gap: 2rem;">
      <img src="${avatarUrl}" alt="${user.username}" style="width: 80px; height: 80px; border-radius: 50%; border: 3px solid var(--accent);">
      <div>
        <h3>${user.username}</h3>
        <p style="color: var(--text-secondary);">Discord ID: ${user.id}</p>
      </div>
    </div>
  `;
}

function displayEconomyInfo(economy) {
  const economyDiv = document.getElementById('economy-info');
  economyDiv.innerHTML = `
    <h3 style="margin-bottom: 1rem;">💰 Economy Stats</h3>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
      <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 6px;">
        <p style="color: var(--text-secondary);">Balance</p>
        <p style="font-size: 1.5rem; color: var(--accent);">⚡ ${economy.balance || 0}</p>
      </div>
      <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 6px;">
        <p style="color: var(--text-secondary);">Bank</p>
        <p style="font-size: 1.5rem; color: var(--success);">🏦 ${economy.bank || 0}</p>
      </div>
      <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 6px;">
        <p style="color: var(--text-secondary);">Total Worth</p>
        <p style="font-size: 1.5rem; color: var(--text-primary);">💎 ${(economy.balance || 0) + (economy.bank || 0)}</p>
      </div>
    </div>
  `;
}

function showDashboard(user) {
  document.querySelector('.hero').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('dashboard-section').style.display = 'block';
  loadDashboardData(user);
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

