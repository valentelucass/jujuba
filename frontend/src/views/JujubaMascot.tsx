import { useId } from 'react'
import jujuba from '../assets/jujuba.png'

export function JujubaMascot({ hero = false }: { hero?: boolean }) {
  const id = useId()
  const leftLid = id + '-left'
  const rightLid = id + '-right'
  const mouth = id + '-mouth'
  const smile = 'M547 709C587 726 638 705 665 673Q690 644 704 666C715 706 684 747 650 762C610 779 560 756 543 729Q534 715 547 709Z'

  return <span className={'jujuba-mascot' + (hero ? ' jujuba-hero' : '')} aria-hidden="true">
    <img src={jujuba} alt="" draggable={false} />
    <svg className="jujuba-expression" viewBox="0 0 1254 1254" aria-hidden="true">
      <defs>
        <linearGradient id={leftLid} x1="375" y1="524" x2="466" y2="704" gradientUnits="userSpaceOnUse">
          <stop stopColor="#bc0b82" />
          <stop offset=".52" stopColor="#ca128c" />
          <stop offset="1" stopColor="#d6198c" />
        </linearGradient>
        <linearGradient id={rightLid} x1="824" y1="554" x2="778" y2="696" gradientUnits="userSpaceOnUse">
          <stop stopColor="#b80778" />
          <stop offset=".55" stopColor="#cf0e87" />
          <stop offset="1" stopColor="#d91489" />
        </linearGradient>
        <clipPath id={mouth}><path d={smile} /></clipPath>
      </defs>
      <g className="jujuba-eyelid jujuba-eyelid-left">
        <path fill={`url(#${leftLid})`} d="M350 612C350 563 387 522 434 522S520 564 520 613 482 706 434 706 350 663 350 612Z" />
        <path className="jujuba-closed-eye" d="M365 607Q431 660 504 604" />
      </g>
      <g className="jujuba-eyelid jujuba-eyelid-right">
        <path fill={`url(#${rightLid})`} d="M700 603 848 556Q867 551 867 570L853 611V626C853 666 826 697 784 697 740 697 712 661 711 622L704 616Q699 613 700 603Z" />
        <path className="jujuba-closed-eye" d="M726 611Q782 657 843 594" />
      </g>
      <g className="jujuba-smile">
        <path d={smile} fill="#520133" />
        <g clipPath={`url(#${mouth})`}>
          <path d="M543 710C586 724 645 704 695 665C688 691 663 715 629 729C591 742 559 733 543 718Z" fill="#ffe1f2" />
          <path d="M572 760Q592 732 620 746Q638 728 665 755L658 780H581Z" fill="#ef518f" />
        </g>
      </g>
    </svg>
  </span>
}
