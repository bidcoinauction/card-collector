export default function SkeletonCard() {
  return (
    <div className="card skel">
      <div className="skelImg" />
      <div className="skelBody">
        <div className="skelLine w70" />
        <div className="skelLine w50" />
        <div className="skelPills">
          <div className="skelPill" />
          <div className="skelPill" />
          <div className="skelPill" />
        </div>
      </div>
      <div className="skelActions">
        <div className="skelBtn" />
        <div className="skelBtn" />
      </div>
    </div>
  );
}
