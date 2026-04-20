function InfoTip({ text }) {
  return (
    <span className="info-tip" tabIndex={0} aria-label={text}>
      i
      <span className="info-tip-box">{text}</span>
    </span>
  );
}

export default InfoTip;
