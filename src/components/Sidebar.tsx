export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandTitle">Card Collector</div>
      </div>

      <nav className="nav">
        <a className="navItem">Dashboard</a>
        <a className="navItem active">My Collection</a>
        <a className="navItem">Analytics</a>
        <a className="navItem">Settings</a>
      </nav>

      <div className="sidebarBox">
        <div className="sbTitle">Coming Soon</div>
        <div className="sbText">eBay API integration for price tracking and comparisons</div>
        <span className="sbBadge">In Development</span>
      </div>
    </aside>
  );
}
